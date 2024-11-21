const z = require('zod');

// Environment variable validation schema
const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
    DISCORD_CHANNEL_ID: z.string().min(1, 'Discord channel ID is required'),
    CHECK_INTERVAL: z.string().transform(Number).default('5'),
    LOG_LEVEL: z.enum(['none', 'debug', 'info', 'warn', 'error']).default('info'),
});

// Application configuration schema
const configSchema = z.object({
    status: z.object({
        url: z.string().url(),
        timeout: z.number(),
        retries: z.number(),
        components: z.array(z.string()),
        userAgent: z.string(),
    }),
    discord: z.object({
        token: z.string(),
        channelId: z.string(),
        checkInterval: z.number(),
    }),
    logging: z.object({
        level: z.enum(['none', 'debug', 'info', 'warn', 'error']),
    }),
});

// Validate environment variables
function validateEnv() {
    try {
        return envSchema.parse(process.env);
    } catch (error) {
        console.error('Environment validation failed:', error.errors);
        process.exit(1);
    }
}

// Create and validate configuration
function createConfig() {
    const env = validateEnv();
    
    const config = {
        status: {
            url: 'https://status.anthropic.com',
            timeout: 10000,
            retries: 3,
            components: [
                'console.anthropic.com',
                'api.anthropic.com',
                'api.anthropic.com - Beta Features',
                'anthropic.com'
            ],
            userAgent: 'StatusChecker/1.0',
        },
        discord: {
            token: env.DISCORD_TOKEN,
            channelId: env.DISCORD_CHANNEL_ID,
            checkInterval: env.CHECK_INTERVAL,
        },
        logging: {
            level: env.LOG_LEVEL,
        },
    };

    try {
        return configSchema.parse(config);
    } catch (error) {
        console.error('Configuration validation failed:', error.errors);
        process.exit(1);
    }
}

module.exports = createConfig();