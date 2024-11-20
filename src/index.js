require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const StatusChecker = require('./statusChecker');
const config = require('./config');
const logger = require('./logger');

// Initialize Discord client with minimal required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// Initialize status checker
const statusChecker = new StatusChecker();

// Store the status message ID
let statusMessageId = null;

// Status level colors
const STATUS_COLORS = {
    operational: 0x2ECC71, // Emerald Green
    degraded: 0xF1C40F,   // Sunflower Yellow
    outage: 0xE74C3C,     // Alizarin Red
    maintenance: 0x3498DB, // Peter River Blue
    default: 0x95A5A6     // Concrete Gray
};

// Function to create status monitor embed
function createStatusMonitorEmbed(status) {
    const embed = new EmbedBuilder()
        .setTitle('anthropic status')
        .setDescription(`${getStatusBadge(status.overall.level)} ${status.overall.description.toLowerCase()}`)
        .setTimestamp()
        .setColor(STATUS_COLORS[status.overall.level] || STATUS_COLORS.default)
        .setFooter({ text: 'last updated' });

    // Add components status with dividers
    const componentStatus = Object.entries(status.components)
        .map(([name, data]) => {
            const dot = getStatusDot(data.status.toLowerCase());
            return `${dot} ${name.toLowerCase()}: ${data.status.toLowerCase()}`;
        })
        .join('\n');

    if (componentStatus) {
        embed.addFields({
            name: 'components',
            value: componentStatus
        });
    }

    // Add active incidents with priority sorting
    const activeIncidents = status.incidents
        .filter(i => i.status !== 'resolved')
        .sort((a, b) => {
            const priority = { critical: 3, major: 2, minor: 1, none: 0 };
            return priority[b.impact] - priority[a.impact];
        });

    if (activeIncidents.length > 0) {
        const incidentsList = activeIncidents
            .map(i => {
                const dot = getStatusDot(i.status);
                return `${dot} ${i.name.toLowerCase()}\nstatus: ${i.status.toLowerCase()}`;
            })
            .join('\n\n');

        embed.addFields({
            name: 'active incidents',
            value: incidentsList
        });
    }

    return embed;
}

// Function to create incident embed
function createIncidentEmbed(incident, isNew = false) {
    const embed = new EmbedBuilder()
        .setTitle(incident.name.toLowerCase())
        .setColor(getIncidentColor(incident.impact))
        .setTimestamp();

    // Add impact and status
    const dot = getStatusDot(incident.status);
    embed.setDescription(
        `impact: ${incident.impact.toLowerCase()}\n` +
        `${dot} status: ${incident.status.toLowerCase()}\n\n` +
        `timeline:`
    );

    // Add updates with timeline formatting
    if (incident.updates && incident.updates.length > 0) {
        const updatesText = incident.updates
            .map((update, index) => {
                const date = new Date(update.timestamp).toLocaleString();
                const dot = getStatusDot(update.status);
                return `${dot} ${update.status.toLowerCase()} - ${date}\n${update.message.toLowerCase()}`;
            })
            .join('\n\n');

        embed.addFields({
            name: 'updates',
            value: updatesText
        });
    }

    return embed;
}

// Helper function to get status badge
function getStatusBadge(status) {
    switch (status) {
        case 'operational':
            return '●';
        case 'degraded':
            return '●';
        case 'outage':
            return '●';
        case 'maintenance':
            return '●';
        default:
            return '○';
    }
}

// Helper function to get status dot
function getStatusDot(status) {
    switch (status) {
        case 'operational':
            return '●';
        case 'degraded':
            return '●';
        case 'outage':
            return '●';
        case 'maintenance':
            return '●';
        case 'investigating':
            return '○';
        case 'identified':
            return '○';
        case 'monitoring':
            return '○';
        case 'resolved':
            return '●';
        default:
            return '○';
    }
}

// Helper function to get timeline header
function getTimelineHeader() {
    return '```\n📅 Timeline\n```';
}

// Helper function to get incident color based on impact
function getIncidentColor(impact) {
    switch (impact) {
        case 'critical':
            return STATUS_COLORS.outage;
        case 'major':
            return STATUS_COLORS.degraded;
        case 'minor':
            return STATUS_COLORS.maintenance;
        default:
            return STATUS_COLORS.default;
    }
}

// Function to handle Discord messages
async function handleStatusUpdate(currentState, updates) {
    try {
        logger.info('Handling status update');
        const channel = await client.channels.fetch(config.discord.channelId);
        
        if (!channel) {
            logger.error('Could not find the specified channel:', {
                channelId: config.discord.channelId
            });
            return;
        }

        // Update or create status monitor message
        const statusEmbed = createStatusMonitorEmbed(currentState);
        
        if (statusMessageId) {
            try {
                const statusMessage = await channel.messages.fetch(statusMessageId);
                await statusMessage.edit({ embeds: [statusEmbed] });
                logger.info('Status monitor message updated');
            } catch (error) {
                logger.info('Could not find status message, creating new one');
                const newMessage = await channel.send({ embeds: [statusEmbed] });
                statusMessageId = newMessage.id;
            }
        } else {
            const newMessage = await channel.send({ embeds: [statusEmbed] });
            statusMessageId = newMessage.id;
            logger.info('Created new status monitor message:', { messageId: statusMessageId });
        }

        // Handle updates if they exist and are in the correct format
        if (updates) {
            // If updates is a single object (initial update), don't try to iterate
            if (updates.type === 'initial') {
                console.log('Processing initial update');
                return;
            }

            // If updates is an array, process each update
            if (Array.isArray(updates)) {
                for (const update of updates) {
                    if (update.type === 'new_incident') {
                        await channel.send({ embeds: [createIncidentEmbed(update.incident, true)] });
                        console.log('Sent new incident notification');
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error handling status update:', error);
        console.error('Error details:', error.stack);
    }
}

// Set up status checking schedule
function setupStatusChecking() {
    logger.info('Setting up status monitoring', {
        interval: config.discord.checkInterval,
        channelId: config.discord.channelId
    });

    // Schedule status checks using node-cron
    cron.schedule(`*/${config.discord.checkInterval} * * * *`, async () => {
        logger.debug('Initiating status check');
        try {
            const updates = await statusChecker.checkForUpdates();
            const currentState = statusChecker.getCurrentState();
            await handleStatusUpdate(currentState, updates);
        } catch (error) {
            logger.logError(error, { operation: 'statusCheck' });
        }
    });

    // Initial check
    statusChecker.checkForUpdates()
        .then(updates => {
            const currentState = statusChecker.getCurrentState();
            return handleStatusUpdate(currentState, updates);
        })
        .catch(error => {
            logger.logError(error, { operation: 'initialStatusCheck' });
            process.exit(1);
        });
}

// Discord client events
client.once('ready', () => {
    logger.info(`Bot is ready! Logged in as ${client.user.tag}`);
    setupStatusChecking();
});

// Error handling
client.on('error', error => {
    logger.logError(error, { source: 'discordClient' });
});

process.on('unhandledRejection', error => {
    logger.logError(error, { source: 'unhandledRejection' });
});

process.on('uncaughtException', error => {
    logger.logError(error, { source: 'uncaughtException' });
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal. Initiating graceful shutdown...');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('Received SIGINT signal. Initiating graceful shutdown...');
    client.destroy();
    process.exit(0);
});

// Start the bot
logger.info('Starting bot...', {
    channelId: config.discord.channelId ? 'Set' : 'Not set',
    checkInterval: config.discord.checkInterval
});

client.login(config.discord.token).catch(error => {
    logger.logError(error, { operation: 'login' });
    process.exit(1);
});