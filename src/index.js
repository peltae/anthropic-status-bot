require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const StatusChecker = require('./statusChecker');
const config = require('./config');
const logger = require('./logger');
const { createStatusEmbed, createIncidentEmbed } = require('./utils/embedUtils');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const statusChecker = new StatusChecker();
let statusMessageId = null;

async function updateStatusMessage(channel, currentState) {
    const statusEmbed = createStatusEmbed(currentState);
    
    try {
        if (statusMessageId) {
            const statusMessage = await channel.messages.fetch(statusMessageId);
            await statusMessage.edit({ embeds: [statusEmbed] });
            logger.info('Status monitor message updated');
        } else {
            const newMessage = await channel.send({ embeds: [statusEmbed] });
            statusMessageId = newMessage.id;
            logger.info('Created status monitor message', { messageId: statusMessageId });
        }
    } catch (error) {
        logger.warn('Could not find status message, creating new one');
        const newMessage = await channel.send({ embeds: [statusEmbed] });
        statusMessageId = newMessage.id;
    }
}

async function handleNewIncidents(channel, updates) {
    if (!Array.isArray(updates)) return;
    
    for (const update of updates) {
        if (update.type === 'new_incident') {
            await channel.send({ embeds: [createIncidentEmbed(update.incident)] });
            logger.info('Sent new incident notification');
        }
    }
}

async function handleStatusUpdate(currentState, updates) {
    try {
        logger.info('Handling status update');
        const channel = await client.channels.fetch(config.discord.channelId);
        
        if (!channel) {
            logger.error('Could not find channel', { channelId: config.discord.channelId });
            return;
        }

        await updateStatusMessage(channel, currentState);
        
        if (updates && updates.type !== 'initial') {
            await handleNewIncidents(channel, updates);
        }
    } catch (error) {
        logger.logError(error, { operation: 'handleStatusUpdate' });
    }
}

function setupStatusChecking() {
    const checkStatus = async () => {
        try {
            const updates = await statusChecker.checkForUpdates();
            const currentState = statusChecker.getCurrentState();
            await handleStatusUpdate(currentState, updates);
        } catch (error) {
            logger.logError(error, { operation: 'statusCheck' });
        }
    };

    logger.info('Setting up status monitoring', {
        interval: config.discord.checkInterval,
        channelId: config.discord.channelId
    });

    cron.schedule(`*/${config.discord.checkInterval} * * * *`, checkStatus);
    checkStatus().catch(error => {
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