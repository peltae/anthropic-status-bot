const winston = require('winston');
const config = require('./config');

// Create a no-op logger for 'none' level
const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    stream: { write: () => {} },
    logRequest: () => {},
    logError: () => {}
};

const logger = config.logging.level === 'none' ? noopLogger : winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'status-bot' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? 
                        '\n' + JSON.stringify(meta, null, 2) : '';
                    return `${timestamp} [${level}]: ${message}${metaStr}`;
                })
            )
        }),
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        })
    ]
});

// Create a stream for Morgan (if we add Express later)
logger.stream = {
    write: (message) => logger.info(message.trim())
};

// Add request logging helper
logger.logRequest = (method, url, duration, status) => {
    logger.info(`${method} ${url} ${status} ${duration}ms`);
};

// Add error logging helper with stack traces
logger.logError = (error, context = {}) => {
    logger.error(error.message, {
        ...context,
        stack: error.stack,
        name: error.name,
        code: error.code
    });
};

module.exports = logger;