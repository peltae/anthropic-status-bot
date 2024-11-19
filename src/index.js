require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const StatusChecker = require('./statusChecker');

// Initialize Discord client with minimal required intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// Initialize status checker
const statusChecker = new StatusChecker();

// Channel ID from environment variables
const channelId = process.env.DISCORD_CHANNEL_ID;
const checkInterval = process.env.CHECK_INTERVAL || 5; // Default to 5 minutes

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
        .setTitle('🌟 Anthropic Status Monitor')
        .setDescription(`${getStatusBadge(status.overall.level)} **Current Status:** ${status.overall.description}`)
        .setTimestamp()
        .setColor(STATUS_COLORS[status.overall.level] || STATUS_COLORS.default)
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
        console.log('Handling status update');
        const channel = await client.channels.fetch(channelId);
        
        if (!channel) {
            console.error('Could not find the specified channel:', channelId);
            return;
        }

        // Update or create status monitor message
        const statusEmbed = createStatusMonitorEmbed(currentState);
        
        if (statusMessageId) {
            try {
                const statusMessage = await channel.messages.fetch(statusMessageId);
                await statusMessage.edit({ embeds: [statusEmbed] });
                console.log('Status monitor message updated');
            } catch (error) {
                console.log('Could not find status message, creating new one');
                const newMessage = await channel.send({ embeds: [statusEmbed] });
                statusMessageId = newMessage.id;
            }
        } else {
            const newMessage = await channel.send({ embeds: [statusEmbed] });
            statusMessageId = newMessage.id;
            console.log('Created new status monitor message:', statusMessageId);
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
    console.log(`Setting up status checks every ${checkInterval} minutes`);
    console.log('Using channel ID:', channelId);

    // Schedule status checks using node-cron
    cron.schedule(`*/${checkInterval} * * * *`, async () => {
        console.log('Checking Anthropic status...');
        try {
            const updates = await statusChecker.checkForUpdates();
            const currentState = statusChecker.getCurrentState();
            await handleStatusUpdate(currentState, updates);
        } catch (error) {
            console.error('Error during status check:', error);
        }
    });

    // Initial check
    statusChecker.checkForUpdates().then(updates => {
        const currentState = statusChecker.getCurrentState();
        handleStatusUpdate(currentState, updates);
    }).catch(error => {
        console.error('Error during initial status check:', error);
    });
}

// Discord client events
client.once('ready', () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    setupStatusChecking();
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Start the bot
console.log('Starting bot...');
console.log('Environment variables loaded:', {
    channelId: channelId ? 'Set' : 'Not set',
    checkInterval,
    tokenLength: process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 'Not set'
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Error logging in to Discord:', error);
    process.exit(1);
});