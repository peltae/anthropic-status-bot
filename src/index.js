require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const StatusChecker = require('./statusChecker');
const config = require('./config');
const logger = require('./logger');
const { createStatusEmbed, createIncidentEmbed } = require('./utils/embedUtils');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const statusChecker = new StatusChecker();
const state = { 
    statusMessageId: null, 
    incidentMessages: new Map(),
    lastMessageTime: 0
};

const RATE_LIMIT_DELAY = 1000; // 1 second between messages

async function updateMessage(channel, messageId, embed) {
    // Rate limiting
    const now = Date.now();
    const timeSinceLastMessage = now - state.lastMessageTime;
    if (timeSinceLastMessage < RATE_LIMIT_DELAY) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastMessage));
    }
    state.lastMessageTime = Date.now();

    try {
        if (messageId) {
            try {
                const message = await channel.messages.fetch(messageId);
                await message.edit({ embeds: [embed] });
                return messageId;
            } catch (error) {
                // If message not found or can't be edited, create new one
                if (error.code === 10008 || error.code === 50005) {
                    const message = await channel.send({ embeds: [embed] });
                    return message.id;
                }
                throw error; // Re-throw other errors
            }
        }
        const message = await channel.send({ embeds: [embed] });
        return message.id;
    } catch (error) {
        logger.logError(error, { operation: 'updateMessage' });
        // Last resort: try to send a new message
        try {
            const message = await channel.send({ embeds: [embed] });
            return message.id;
        } catch (finalError) {
            logger.logError(finalError, { operation: 'updateMessage_fallback' });
            return null;
        }
    }
}

async function handleStatusUpdate(currentState, updates) {
    try {
        const channel = await client.channels.fetch(config.discord.channelId);
        if (!channel) return;

        // Update status message
        state.statusMessageId = await updateMessage(
            channel, 
            state.statusMessageId, 
            createStatusEmbed(currentState)
        );

        // Handle incident updates
        if (updates?.type !== 'initial' && Array.isArray(updates)) {
            for (const update of updates) {
                if (['new_incident', 'incident_update'].includes(update.type)) {
                    const messageId = await updateMessage(
                        channel,
                        state.incidentMessages.get(update.incident.id),
                        createIncidentEmbed(update.incident)
                    );
                    state.incidentMessages.set(update.incident.id, messageId);
                }
            }
        }
    } catch (error) {
        logger.logError(error, { operation: 'handleStatusUpdate' });
    }
}

async function checkStatus() {
    try {
        const updates = await statusChecker.checkForUpdates();
        await handleStatusUpdate(statusChecker.getCurrentState(), updates);
    } catch (error) {
        logger.logError(error, { operation: 'statusCheck' });
    }
}

// Event handlers
client.once('ready', () => {
    logger.info(`Bot ready as ${client.user.tag}`);
    cron.schedule(`*/${config.discord.checkInterval} * * * *`, checkStatus);
    checkStatus();
});

client.on('error', error => logger.logError(error, { operation: 'discord' }));

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    try {
        // Cancel scheduled tasks
        cron.getTasks().forEach(task => task.stop());
        
        // Wait for any pending status checks to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Destroy Discord client
        if (client.isReady()) {
            await client.destroy();
            logger.info('Discord client destroyed');
        }
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.logError(error, { operation: 'shutdown' });
        process.exit(1);
    }
}

['SIGTERM', 'SIGINT'].forEach(signal => {
    process.on(signal, () => shutdown(signal));
});

client.login(config.discord.token).catch(error => {
    logger.logError(error, { operation: 'login' });
    process.exit(1);
});