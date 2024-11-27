const winston = require('winston');
const config = require('./config');

const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const metaStr = Object.entries(meta)
                .filter(([key]) => key !== 'service')
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
            return `${timestamp.split('T')[1].split('.')[0]} ${level}: ${metaStr ? `${message} (${metaStr})` : message}`;
        })
    ),
    transports: [new winston.transports.Console()]
});

logger.logRequest = (method, url, duration, status) => logger.info(`${method} ${url} - ${status} (${duration}ms)`);
logger.logError = (error, context = {}) => logger.error(`${error.message}${context.operation ? ` in ${context.operation}` : ''}`);

module.exports = logger;