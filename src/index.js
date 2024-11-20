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
        .setAuthor({
            name: 'ANTHROP\C',
            iconURL: 'attachment://logo.png'
        })
        .setTitle('Status Monitor')
        .setDescription(`${getStatusBadge(status.overall.level)} **Current Status:** ${status.overall.description}`)
        .setTimestamp()
        .setColor(0xE6B8A2) // Anthropic's warm beige color
        .setFooter({ text: '🔄 Last Updated' });

    // Add components status with dividers
    const componentStatus = Object.entries(status.components)
        .map(([name, data]) => {
            const emoji = getStatusEmoji(data.status.toLowerCase());
            const statusText = data.status.charAt(0).toUpperCase() + data.status.slice(1);
            return `${emoji} **${name}**\n┗━ ${statusText}`;
        })
        .join('\n\n');

    if (componentStatus) {
        embed.addFields({
            name: '🔧 System Components',
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
                const emoji = getImpactEmoji(i.impact);
                const statusEmoji = getStatusEmoji(i.status);
                return `${emoji} **${i.name}**\n┗━ ${statusEmoji} Status: ${i.status.charAt(0).toUpperCase() + i.status.slice(1)}`;
            })
            .join('\n\n');

        embed.addFields({
            name: '⚠️ Active Incidents',
            value: incidentsList
        });
    }

    return embed;
}

// Function to create incident embed
function createIncidentEmbed(incident, isNew = false) {
    const embed = new EmbedBuilder()
        .setTitle(`${isNew ? '🚨' : '📝'} ${incident.name}`)
        .setColor(getIncidentColor(incident.impact))
        .setTimestamp();

    // Add impact badge and status
    const impactEmoji = getImpactEmoji(incident.impact);
    const statusEmoji = getStatusEmoji(incident.status);
    
    embed.setDescription(
        `${impactEmoji} **Impact Level:** ${incident.impact.toUpperCase()}\n` +
        `${statusEmoji} **Current Status:** ${incident.status.charAt(0).toUpperCase() + incident.status.slice(1)}\n\n` +
        `${getTimelineHeader()}`
    );

    // Add updates with timeline formatting
    if (incident.updates && incident.updates.length > 0) {
        const updatesText = incident.updates
            .map((update, index) => {
                const date = new Date(update.timestamp).toLocaleString();
                const isLast = index === incident.updates.length - 1;
                const lineStyle = isLast ? '┗' : '┣';
                
                return `${lineStyle}━ ${getStatusEmoji(update.status)} **${update.status.toUpperCase()}** - ${date}\n` +
                       `   ${update.message}`;
            })
            .join('\n\n');

        embed.addFields({
            name: '📋 Updates',
            value: updatesText
        });
    }

    return embed;
}

// Helper function to get status badge (larger emoji combinations)
function getStatusBadge(status) {
    switch (status) {
        case 'operational':
            return '🟢 ✨';
        case 'degraded':
            return '🟡 ⚠️';
        case 'outage':
            return '🔴 ❌';
        case 'maintenance':
            return '🔧 🔄';
        default:
            return 'ℹ️';
    }
}

// Helper function to get status emoji
function getStatusEmoji(status) {
    switch (status) {
        case 'operational':
            return '🟢';
        case 'degraded':
            return '🟡';
        case 'outage':
            return '🔴';
        case 'maintenance':
            return '🔧';
        case 'investigating':
            return '🔍';
        case 'identified':
            return '🔎';
        case 'monitoring':
            return '👀';
        case 'resolved':
            return '✅';
        default:
            return 'ℹ️';
    }
}

// Helper function to get impact emoji
function getImpactEmoji(impact) {
    switch (impact) {
        case 'critical':
            return '💥';
        case 'major':
            return '⚡';
        case 'minor':
            return '⚠️';
        default:
            return 'ℹ️';
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
                await statusMessage.edit({ 
                    files: [{
                        attachment: './bin/logo.png',
                        name: 'logo.png'
                    }],
                    embeds: [statusEmbed] 
                });
                logger.info('Status monitor message updated');
            } catch (error) {
                logger.info('Could not find status message, creating new one');
                const newMessage = await channel.send({ 
                    files: [{
                        attachment: './bin/logo.png',
                        name: 'logo.png'
                    }],
                    embeds: [statusEmbed] 
                });
                statusMessageId = newMessage.id;
            }
        } else {
            const newMessage = await channel.send({ 
                files: [{
                    attachment: './bin/logo.png',
                    name: 'logo.png'
                }],
                embeds: [statusEmbed] 
            });
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