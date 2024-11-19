const axios = require('axios');
const cheerio = require('cheerio');

class StatusChecker {
    constructor() {
        this.previousState = null;
        this.currentState = null;
        this.STATUS_URL = 'https://status.anthropic.com';
        this.components = new Set([
            'console.anthropic.com',
            'api.anthropic.com',
            'api.anthropic.com - Beta Features',
            'anthropic.com'
        ]);
        
        this.selectors = {
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
                update: '.update'
            }
        };
    }

    async fetchStatus() {
        try {
            const response = await axios.get(this.STATUS_URL, {
                timeout: 10000,
                headers: {
                    'Accept': 'text/html'
                }
            });
            
            const $ = cheerio.load(response.data);
            const currentStatus = {
                overall: this.parseOverallStatus($),
                components: this.parseComponents($),
                incidents: this.parseIncidents($),
                timestamp: new Date().toISOString()
            };

            return currentStatus;
        } catch (error) {
            const errorDetails = {
                message: error.message,
                status: error.response?.status,
                headers: error.response?.headers
            };
            console.error('Error fetching Anthropic status:', errorDetails);
            return null;
        }
    }

    parseOverallStatus($) {
        const { overall } = this.selectors;
        const statusText = $(overall.description).text().trim();
        const statusClass = $(overall.status).attr('class') || '';
        
        const status = {
            description: statusText || 'All Systems Operational',
            level: 'operational'
        };

        const statusMap = new Map([
            ['degraded', () => status.level = 'degraded'],
            ['outage', () => status.level = 'outage'],
            ['maintenance', () => status.level = 'maintenance']
        ]);

        for (const [key, setter] of statusMap) {
            if (statusClass.includes(key)) {
                setter();
                break;
            }
        }

        return status;
    }

    parseComponents($) {
        const { component } = this.selectors;
        const components = {};
        const timestamp = new Date().toISOString();

        $(component.container).each((_, element) => {
            const $element = $(element);
            const name = $element.find(component.name).text().trim();
            
            if (this.components.has(name)) {
                components[name] = {
                    status: $element.find(component.status).text().trim(),
                    timestamp
                };
            }
        });

        return components;
    }

    parseIncidents($) {
        const { incident } = this.selectors;
        
        const parseUpdate = ($update) => {
            const status = $update.find('strong').text().trim().toLowerCase();
            const message = $update.find('.whitespace-pre-wrap').text().trim();
            const $small = $update.find('small');
            
            const dateInfo = {
                month: $small.text().trim().split(' ')[0],
                day: $small.find('var[data-var="date"]').text().trim(),
                time: $small.find('var[data-var="time"]').text().trim(),
                year: $small.find('var[data-var="year"]').text().trim() || new Date().getFullYear().toString()
            };

            return {
                status,
                message,
                timestamp: this.parseTimestamp(`${dateInfo.month} ${dateInfo.day}, ${dateInfo.year} ${dateInfo.time}`)
            };
        };

        const parseIncident = ($incident) => {
            const $title = $incident.find(incident.title);
            const titleClass = $title.attr('class') || '';
            
            const impactMap = new Map([
                ['impact-minor', 'minor'],
                ['impact-major', 'major'],
                ['impact-critical', 'critical']
            ]);

            let impact = 'none';
            for (const [className, impactLevel] of impactMap) {
                if (titleClass.includes(className)) {
                    impact = impactLevel;
                    break;
                }
            }

            const updates = [];
            $incident.find('.update').each((_, el) => updates.push(parseUpdate($(el))));

            return {
                id: $title.find('a').attr('href')?.split('/').pop() || Date.now().toString(),
                name: $title.find('a').text().trim(),
                impact,
                status: updates[0]?.status || 'investigating',
                updates
            };
        };

        const incidents = [];
        $('.status-day').each((_, dayElement) => {
            $(dayElement).find(incident.container).each((_, el) => {
                incidents.push(parseIncident($(el)));
            });
        });

        return incidents;
    }

    parseTimestamp(timestamp) {
        try {
            const date = new Date(timestamp + ' PST');
            return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    getCurrentState() {
        return this.currentState;
    }

    async checkForUpdates() {
        const currentState = await this.fetchStatus();
        
        if (!currentState) {
            return null;
        }

        this.currentState = currentState;

        if (!this.previousState) {
            this.previousState = currentState;
            return {
                type: 'initial',
                message: `Status monitoring initialized.
Current Status: ${currentState.overall.description}
${this.formatComponentStatuses(currentState.components)}`,
                timestamp: currentState.timestamp
            };
        }

        const updates = this.compareStates(this.previousState, currentState);
        this.previousState = currentState;

        return updates;
    }

    formatComponentStatuses(components) {
        return Object.entries(components)
            .map(([name, data]) => `${name}: ${data.status}`)
            .join('\n');
    }

    compareStates(previous, current) {
        const updates = [];

        if (previous.overall.description !== current.overall.description) {
            updates.push({
                type: 'status_change',
                message: `System status changed to: ${current.overall.description}`,
                timestamp: current.timestamp,
                level: current.overall.level
            });
        }

        for (const [component, currentStatus] of Object.entries(current.components)) {
            const previousStatus = previous.components[component];
            if (!previousStatus || previousStatus.status !== currentStatus.status) {
                updates.push({
                    type: 'component_update',
                    message: `${component} status changed to: ${currentStatus.status}`,
                    timestamp: currentStatus.timestamp,
                    component
                });
            }
        }

        if (current.incidents.length > 0) {
            const currentIncidentIds = new Set(current.incidents.map(i => i.id));
            const previousIncidentIds = new Set(previous.incidents.map(i => i.id));

            for (const incident of current.incidents) {
                if (!previousIncidentIds.has(incident.id)) {
                    updates.push({
                        type: 'new_incident',
                        message: `New incident reported:
${incident.name}
Impact: ${incident.impact}
Status: ${incident.status}`,
                        timestamp: incident.updates[0]?.timestamp || current.timestamp,
                        incident
                    });
                    continue;
                }

                const previousIncident = previous.incidents.find(i => i.id === incident.id);
                if (previousIncident && 
                    (previousIncident.status !== incident.status || 
                     previousIncident.updates.length !== incident.updates.length)) {
                    updates.push({
                        type: 'incident_update',
                        message: `Incident "${incident.name}" status updated to: ${incident.status}`,
                        timestamp: incident.updates[0]?.timestamp || current.timestamp,
                        incident
                    });
                }
            }
        }

        return updates.length > 0 ? updates : null;
    }
}

module.exports = StatusChecker;