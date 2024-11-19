const fs = require('fs').promises;
const path = require('path');
const StatusChecker = require('./statusChecker');

class TestStatusChecker extends StatusChecker {
    async fetchStatus() {
        try {
            const htmlContent = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const $ = this.parseHTML(htmlContent);
            
            const currentStatus = {
                overall: this.parseOverallStatus($),
                components: this.parseComponents($),
                incidents: this.parseIncidents($),
                timestamp: new Date().toISOString()
            };

            return currentStatus;
        } catch (error) {
            console.error('Error loading test data:', error.message);
            return null;
        }
    }

    parseHTML(content) {
        const cheerio = require('cheerio');
        return cheerio.load(content);
    }
}

const formatUpdate = (update) => `  Status: ${update.status}
  Message: ${update.message}
  Timestamp: ${update.timestamp}`;

const formatIncident = (incident, index) => `Incident ${index + 1}:
Name: ${incident.name}
ID: ${incident.id}
Impact: ${incident.impact}
Status: ${incident.status}

Updates:
${incident.updates.map(formatUpdate).join('\n\n')}`;

async function runTest() {
    const checker = new TestStatusChecker();
    console.log('Testing incident parsing...');
    
    const status = await checker.fetchStatus();
    
    if (!status) {
        console.log('Failed to parse incidents');
        return;
    }

    console.log('\nParsed Incidents:');
    const formattedIncidents = status.incidents
        .map(formatIncident)
        .join('\n\n');
    
    console.log(formattedIncidents);
}

runTest().catch(console.error);