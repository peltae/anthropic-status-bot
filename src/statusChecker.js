const axios = require('axios');
const cheerio = require('cheerio');

class StatusChecker {
    constructor() {
        this.previousState = null;
        this.currentState = null;
        this.STATUS_URL = 'https://status.anthropic.com';
        this.components = [
            'console.anthropic.com',
            'api.anthropic.com',
            'api.anthropic.com - Beta Features',
            'anthropic.com'
        ];
    }

    async fetchStatus() {
        try {
            console.log('Fetching status from:', this.STATUS_URL);
            const response = await axios.get(this.STATUS_URL);
            console.log('Status page fetched successfully');
            
            const $ = cheerio.load(response.data);
            
            // Parse current status
            const currentStatus = {
                overall: this.parseOverallStatus($),
                components: this.parseComponents($),
                incidents: this.parseIncidents($),
                timestamp: new Date().toISOString()
            };

            console.log('Parsed status:', {
                overallLevel: currentStatus.overall.level,
                componentCount: Object.keys(currentStatus.components).length,
                incidentCount: currentStatus.incidents.length
            });

            return currentStatus;
        } catch (error) {
            console.error('Error fetching Anthropic status:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response headers:', error.response.headers);
            }
            return null;
        }
    }

    parseOverallStatus($) {
        console.log('Parsing overall status');
        // Parse the overall system status
        const statusText = $('.overall-status__description').text().trim();
        const statusClass = $('.overall-status').attr('class') || '';
        
        let status = {
            description: statusText || 'All Systems Operational',
            level: 'operational'
        };

        if (statusClass.includes('degraded')) {
            status.level = 'degraded';
        } else if (statusClass.includes('outage')) {
            status.level = 'outage';
        } else if (statusClass.includes('maintenance')) {
            status.level = 'maintenance';
        }

        console.log('Overall status:', status);
        return status;
    }

    parseComponents($) {
        console.log('Parsing components');
        const components = {};
        
        // Parse each component's status
        $('.component-container').each((_, element) => {
            const name = $(element).find('.name').text().trim();
            const status = $(element).find('.component-status').text().trim();
            
            if (this.components.includes(name)) {
                components[name] = {
                    status,
                    timestamp: new Date().toISOString()
                };
            }
        });

        console.log('Found components:', Object.keys(components).length);
        return components;
    }

    parseIncidents($) {
        console.log('Parsing incidents');
        const incidents = [];
        
        // Parse incident updates
        $('.status-day').each((_, dayElement) => {
            const $day = $(dayElement);
            const date = $day.find('.date').text().trim();
            console.log('Parsing incidents for date:', date);
            
            $day.find('.incident-container').each((_, element) => {
                const $incident = $(element);
                const $title = $incident.find('.incident-title');
                
                // Get impact level from class
                const titleClass = $title.attr('class') || '';
                let impact = 'none';
                if (titleClass.includes('impact-minor')) impact = 'minor';
                if (titleClass.includes('impact-major')) impact = 'major';
                if (titleClass.includes('impact-critical')) impact = 'critical';

                const incident = {
                    id: $title.find('a').attr('href')?.split('/').pop() || Date.now().toString(),
                    name: $title.find('a').text().trim(),
                    impact,
                    status: 'investigating', // Default status
                    updates: []
                };

                // Parse updates within each incident
                $incident.find('.update').each((_, updateElement) => {
                    const $update = $(updateElement);
                    const status = $update.find('strong').text().trim().toLowerCase();
                    const message = $update.find('.whitespace-pre-wrap').text().trim();
                    
                    // Parse timestamp from var tags
                    const $small = $update.find('small');
                    const month = $small.text().trim().split(' ')[0];
                    const day = $small.find('var[data-var="date"]').text().trim();
                    const time = $small.find('var[data-var="time"]').text().trim();
                    const year = $small.find('var[data-var="year"]').text().trim() || new Date().getFullYear();
                    
                    incident.updates.push({
                        status,
                        message,
                        timestamp: this.parseTimestamp(`${month} ${day}, ${year} ${time}`)
                    });
                });

                // Set incident status to the most recent update's status
                if (incident.updates.length > 0) {
                    incident.status = incident.updates[0].status;
                }

                console.log('Parsed incident:', {
                    name: incident.name,
                    impact: incident.impact,
                    status: incident.status,
                    updateCount: incident.updates.length
                });

                incidents.push(incident);
            });
        });

        console.log('Total incidents parsed:', incidents.length);
        return incidents;
    }

    parseTimestamp(timestamp) {
        // Convert PST/PDT timestamp to ISO string
        try {
            const date = new Date(timestamp + ' PST');
            return date.toISOString();
        } catch (error) {
            console.error('Error parsing timestamp:', timestamp, error);
            return new Date().toISOString();
        }
    }

    getCurrentState() {
        return this.currentState;
    }

    async checkForUpdates() {
        console.log('Checking for updates...');
        const currentState = await this.fetchStatus();
        
        if (!currentState) {
            console.log('No current state available');
            return null;
        }

        // Store current state
        this.currentState = currentState;

        if (!this.previousState) {
            console.log('First check, setting initial state');
            this.previousState = currentState;
            return {
                type: 'initial',
                message: 'Status monitoring initialized.\nCurrent Status: ' + 
                        currentState.overall.description + '\n' +
                        this.formatComponentStatuses(currentState.components),
                timestamp: currentState.timestamp
            };
        }

        const updates = this.compareStates(this.previousState, currentState);
        this.previousState = currentState;

        if (updates) {
            console.log('Found updates:', updates.length);
        } else {
            console.log('No updates found');
        }

        return updates;
    }

    formatComponentStatuses(components) {
        return Object.entries(components)
            .map(([name, data]) => `${name}: ${data.status}`)
            .join('\n');
    }

    compareStates(previous, current) {
        console.log('Comparing states');
        const updates = [];

        // Compare overall status
        if (previous.overall.description !== current.overall.description) {
            updates.push({
                type: 'status_change',
                message: `System status changed to: ${current.overall.description}`,
                timestamp: current.timestamp,
                level: current.overall.level
            });
        }

        // Compare component statuses
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

        // Compare incidents
        if (current.incidents.length > 0) {
            const currentIncidentIds = new Set(current.incidents.map(i => i.id));
            const previousIncidentIds = new Set(previous.incidents.map(i => i.id));

            // Check for new incidents
            current.incidents.forEach(incident => {
                if (!previousIncidentIds.has(incident.id)) {
                    updates.push({
                        type: 'new_incident',
                        message: `New incident reported:\n${incident.name}\nImpact: ${incident.impact}\nStatus: ${incident.status}`,
                        timestamp: incident.updates[0]?.timestamp || current.timestamp,
                        incident
                    });
                } else {
                    // Check for updates to existing incidents
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
            });
        }

        return updates.length > 0 ? updates : null;
    }
}

module.exports = StatusChecker;