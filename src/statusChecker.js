const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const cheerio = require('cheerio');
const config = require('./config');
const logger = require('./logger');

class StatusChecker {
    #previousState;
    #currentState;
    #components;
    #selectors;
    #client;
    #recentMessages;
    #MESSAGE_EXPIRY = 60000; // 1 minute in milliseconds

    constructor() {
        this.#previousState = null;
        this.#currentState = null;
        this.#recentMessages = new Map();
        
        // Initialize axios client with retry logic and caching
        this.#client = axios.create({
            timeout: config.status.timeout,
            headers: {
                'Accept': 'text/html',
                'User-Agent': config.status.userAgent,
                'Cache-Control': 'max-age=60' // Cache responses for 60 seconds
            }
        });

        // Configure retry behavior
        axiosRetry(this.#client, {
            retries: config.status.retries,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    (error.response && error.response.status === 429);
            },
            onRetry: (retryCount, error) => {
                logger.warn(`Retry attempt ${retryCount} for request:`, {
                    url: error.config.url,
                    error: error.message
                });
            }
        });
        
        // Use Set for O(1) lookups from config
        this.#components = new Set(config.status.components);
        
        // Cache selectors
        this.#selectors = {
            overall: {
                description: '.overall-status__description',
                status: '.overall-status'
            },
            component: {
                container: '.component-container',
                name: '.name',
                status: '.component-status'
            },
            incident: {
                container: '.incident-container',
                title: '.incident-title',
                update: '.update',
                message: '.whitespace-pre-wrap',
                date: {
                    day: 'var[data-var="date"]',
                    time: 'var[data-var="time"]',
                    year: 'var[data-var="year"]'
                }
            }
        };
    }

    async fetchStatus() {
        try {
            const startTime = Date.now();
            const response = await this.#client.get(config.status.url);
            const duration = Date.now() - startTime;
            
            logger.logRequest('GET', config.status.url, duration, response.status);
            
            const $ = cheerio.load(response.data, {
                normalizeWhitespace: true,
                decodeEntities: true
            });

            return {
                overall: this.#parseOverallStatus($),
                components: this.#parseComponents($),
                incidents: this.#parseIncidents($),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.logError(error, {
                operation: 'fetchStatus',
                url: config.status.url,
                status: error.response?.status,
                headers: error.response?.headers
            });
            return null;
        }
    }

    #parseOverallStatus($) {
        const { overall } = this.#selectors;
        const $status = $(overall.status);
        
        return {
            description: $(overall.description).text().trim() || 'All Systems Operational',
            level: this.#determineStatusLevel($status.attr('class') || '')
        };
    }

    #determineStatusLevel(statusClass) {
        const statusMap = new Map([
            ['degraded', 'degraded'],
            ['outage', 'outage'],
            ['maintenance', 'maintenance']
        ]);

        for (const [key, value] of statusMap) {
            if (statusClass.includes(key)) return value;
        }
        return 'operational';
    }

    #parseComponents($) {
        const { component } = this.#selectors;
        const timestamp = new Date().toISOString();
        const components = {};

        $(component.container).each((_, element) => {
            const $element = $(element);
            const name = $element.find(component.name).text().trim();
            
            if (this.#components.has(name)) {
                components[name] = {
                    status: $element.find(component.status).text().trim(),
                    timestamp
                };
            }
        });

        return components;
    }

    #parseIncidents($) {
        const incidents = [];
        const { incident } = this.#selectors;

        $('.status-day').each((_, dayElement) => {
            const $day = $(dayElement);
            
            $day.find(incident.container).each((_, incidentElement) => {
                const $incident = $(incidentElement);
                incidents.push(this.#parseIncidentElement($, $incident));
            });
        });

        return incidents;
    }

    #parseIncidentElement($, $incident) {
        const { incident } = this.#selectors;
        const $title = $incident.find(incident.title);
        
        return {
            id: $title.find('a').attr('href')?.split('/').pop() || Date.now().toString(),
            name: $title.find('a').text().trim(),
            impact: this.#determineImpactLevel($title.attr('class') || ''),
            status: this.#parseUpdates($, $incident)[0]?.status || 'investigating',
            updates: this.#parseUpdates($, $incident)
        };
    }

    #determineImpactLevel(titleClass) {
        const impactMap = new Map([
            ['impact-minor', 'minor'],
            ['impact-major', 'major'],
            ['impact-critical', 'critical']
        ]);

        for (const [key, value] of impactMap) {
            if (titleClass.includes(key)) return value;
        }
        return 'none';
    }

    #parseUpdates($, $incident) {
        const { incident } = this.#selectors;
        const updates = [];

        $incident.find(incident.update).each((_, updateElement) => {
            const $update = $(updateElement);
            const $small = $update.find('small');
            
            updates.push({
                status: $update.find('strong').text().trim().toLowerCase(),
                message: $update.find(incident.message).text().trim(),
                timestamp: this.#parseTimestamp(this.#extractDateInfo($, $small))
            });
        });

        return updates;
    }

    #extractDateInfo($, $small) {
        const { date } = this.#selectors.incident;
        const month = $small.text().trim().split(' ')[0];
        const day = $small.find(date.day).text().trim();
        const time = $small.find(date.time).text().trim();
        const year = $small.find(date.year).text().trim() || new Date().getFullYear().toString();
        
        return `${month} ${day}, ${year} ${time}`;
    }

    #parseTimestamp(timestamp) {
        try {
            const date = new Date(`${timestamp} PST`);
            return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    getCurrentState() {
        return this.#currentState;
    }

    async checkForUpdates() {
        const currentState = await this.fetchStatus();
        
        if (!currentState) {
            logger.warn('Failed to fetch status update');
            return null;
        }

        this.#currentState = currentState;

        if (!this.#previousState) {
            this.#previousState = currentState;
            logger.info('Status monitoring initialized', {
                status: currentState.overall.description,
                components: this.#formatComponentStatuses(currentState.components)
            });
            return {
                type: 'initial',
                message: `Status monitoring initialized.\nCurrent Status: ${currentState.overall.description}\n${this.#formatComponentStatuses(currentState.components)}`,
                timestamp: currentState.timestamp
            };
        }

        const updates = this.#compareStates(this.#previousState, currentState);
        this.#previousState = currentState;

        return updates;
    }

    #formatComponentStatuses(components) {
        return Object.entries(components)
            .map(([name, data]) => `${name}: ${data.status}`)
            .join('\n');
    }

    #isDuplicate(message, timestamp) {
        const key = `${message}-${timestamp}`;
        const now = Date.now();
        
        // Clean up old messages periodically (every 100 checks)
        if (this.#recentMessages.size > 0 && this.#recentMessages.size % 100 === 0) {
            const expiredTime = now - this.#MESSAGE_EXPIRY;
            for (const [msgKey, msgTime] of this.#recentMessages) {
                if (msgTime < expiredTime) {
                    this.#recentMessages.delete(msgKey);
                }
            }
        }
        
        // Limit Map size to prevent memory leaks
        if (this.#recentMessages.size > 1000) {
            const oldestKey = this.#recentMessages.keys().next().value;
            this.#recentMessages.delete(oldestKey);
        }
        
        // Check if message is a duplicate
        if (this.#recentMessages.has(key)) {
            return true;
        }
        
        // Store new message
        this.#recentMessages.set(key, now);
        return false;
    }

    #compareStates(previous, current) {
        const updates = [];

        if (previous.overall.description !== current.overall.description) {
            const message = `System status changed to: ${current.overall.description}`;
            if (!this.#isDuplicate(message, current.timestamp)) {
                updates.push({
                    type: 'status_change',
                    message,
                    timestamp: current.timestamp,
                    level: current.overall.level
                });
            }
        }

        this.#compareComponents(previous, current, updates);
        this.#compareIncidents(previous, current, updates);

        return updates.length > 0 ? updates : null;
    }

    #compareComponents(previous, current, updates) {
        for (const [component, currentStatus] of Object.entries(current.components)) {
            const previousStatus = previous.components[component];
            if (!previousStatus || previousStatus.status !== currentStatus.status) {
                const message = `${component} status changed to: ${currentStatus.status}`;
                if (!this.#isDuplicate(message, currentStatus.timestamp)) {
                    updates.push({
                        type: 'component_update',
                        message,
                        timestamp: currentStatus.timestamp,
                        component
                    });
                }
            }
        }
    }

    #compareIncidents(previous, current, updates) {
        if (current.incidents.length === 0) return;

        const currentIncidentIds = new Set(current.incidents.map(i => i.id));
        const previousIncidentIds = new Set(previous.incidents.map(i => i.id));

        // Handle new and updated incidents
        for (const incident of current.incidents) {
            const previousIncident = previous.incidents.find(i => i.id === incident.id);
            
            if (!previousIncidentIds.has(incident.id)) {
                updates.push({ type: 'new_incident', incident });
                continue;
            }

            if (previousIncident && 
                (previousIncident.status !== incident.status || 
                previousIncident.updates.length !== incident.updates.length)) {
                updates.push({ type: 'incident_update', incident });
            }
        }

        // Handle resolved incidents
        for (const previousId of previousIncidentIds) {
            if (!currentIncidentIds.has(previousId)) {
                const resolvedIncident = previous.incidents.find(i => i.id === previousId);
                if (resolvedIncident) {
                    updates.push({
                        type: 'incident_resolved',
                        incident: {
                            ...resolvedIncident,
                            status: 'resolved',
                            updates: [
                                { status: 'resolved', message: 'Incident resolved', timestamp: new Date().toISOString() },
                                ...resolvedIncident.updates
                            ]
                        }
                    });
                }
            }
        }
    }
}

module.exports = StatusChecker;