const fs = require('fs').promises;
const path = require('path');
const StatusChecker = require('./statusChecker');

class TestStatusChecker extends StatusChecker {
    async fetchStatus() {
        try {
            // Read the local HTML file instead of making HTTP request
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

async function runTest() {
    const checker = new TestStatusChecker();
    
    console.log('Testing incident parsing...');
    const status = await checker.fetchStatus();
    
    if (status) {
        console.log('\nParsed Incidents:');
        status.incidents.forEach((incident, index) => {
            console.log(`\nIncident ${index + 1}:`);
            console.log('Name:', incident.name);
            console.log('ID:', incident.id);
            console.log('Impact:', incident.impact);
            console.log('Status:', incident.status);
            console.log('Updates:');
            incident.updates.forEach((update, uIndex) => {
                console.log(`\n  Update ${uIndex + 1}:`);
                console.log('  Status:', update.status);
                console.log('  Message:', update.message);
                console.log('  Timestamp:', update.timestamp);
            });
        });
    } else {
        console.log('Failed to parse incidents');
    }
}

runTest().catch(console.error);