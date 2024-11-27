const { z } = require('zod');

const env = z.object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CHANNEL_ID: z.string().min(1),
    CHECK_INTERVAL: z.coerce.number().default(5),
    LOG_LEVEL: z.enum(['info', 'warn', 'error']).default('info'),
}).parse(process.env);

module.exports = {
    status: {
        url: 'https://status.anthropic.com',
        timeout: 10000,
        retries: 3,
        components: ['console.anthropic.com', 'api.anthropic.com', 'api.anthropic.com - Beta Features', 'anthropic.com'],
        userAgent: 'AnthropicStatusBot/1.0'
    },
    discord: {
        token: env.DISCORD_TOKEN,
        channelId: env.DISCORD_CHANNEL_ID,
        checkInterval: env.CHECK_INTERVAL
    },
    logging: { level: env.LOG_LEVEL }
};