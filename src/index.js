require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const StatusChecker = require('./statusChecker');
const config = require('./config');
const logger = require('./logger');
const { createStatusEmbed, createIncidentEmbed } = require('./utils/embedUtils');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const statusChecker = new StatusChecker();
const state = { statusMessageId: null, incidentMessages: new Map() };

async function updateMessage(channel, messageId, embed) {
    try {
        if (messageId) {
            const message = await channel.messages.fetch(messageId);
            await message.edit({ embeds: [embed] });
            return messageId;
        }
        const message = await channel.send({ embeds: [embed] });
        return message.id;
    } catch {
        const message = await channel.send({ embeds: [embed] });
        return message.id;
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
['SIGTERM', 'SIGINT'].forEach(signal => {
    process.on(signal, () => {
        client.destroy();
        process.exit(0);
    });
});

client.login(config.discord.token).catch(error => {
    logger.logError(error, { operation: 'login' });
    process.exit(1);
});