const { EmbedBuilder } = require('discord.js');

const STATUS_COLORS = {
    operational: 0x2ECC71,
    degraded: 0xF1C40F,
    outage: 0xE74C3C,
    maintenance: 0x3498DB,
    default: 0x95A5A6
};

const formatName = name => name.toLowerCase().replace('- beta features', ' (beta)');
const formatStatus = status => status.toLowerCase();
const getStatusDot = status => status.match(/operational|maintenance|resolved/) ? '●' : '○';

const createStatusEmbed = (status) => {
    const embed = new EmbedBuilder()
        .setTitle('anthropic status')
        .setDescription(`${getStatusDot(status.overall.level)} ${formatStatus(status.overall.description)}`)
        .setTimestamp()
        .setColor(STATUS_COLORS[status.overall.level] || STATUS_COLORS.default);

    const componentStatus = Object.entries(status.components)
        .map(([name, data]) => `${getStatusDot(data.status)} ${formatName(name)} · ${formatStatus(data.status)}`)
        .join('\n');

    if (componentStatus) {
        embed.addFields({ name: 'components', value: componentStatus });
    }

    const activeIncidents = status.incidents.filter(i => i.status !== 'resolved');
    if (activeIncidents.length > 0) {
        const incidentsList = activeIncidents
            .map(i => `${getStatusDot(i.status)} ${formatStatus(i.name)}\n    status: ${formatStatus(i.status)}`)
            .join('\n\n');
        embed.addFields({ name: 'active incidents', value: incidentsList });
    }

    return embed;
};

const createIncidentEmbed = (incident) => {
    const embed = new EmbedBuilder()
        .setTitle(formatStatus(incident.name))
        .setColor(STATUS_COLORS[incident.impact] || STATUS_COLORS.default)
        .setTimestamp()
        .setDescription(
            `impact: ${formatStatus(incident.impact)}\n` +
            `${getStatusDot(incident.status)} status: ${formatStatus(incident.status)}`
        );

    if (incident.updates?.length > 0) {
        const updatesText = incident.updates
            .map(update => (
                `${getStatusDot(update.status)} ${formatStatus(update.status)}\n` +
                `    ${new Date(update.timestamp).toLocaleString()}\n` +
                `    ${update.message}`
            ))
            .join('\n\n');
        
        embed.addFields({ name: 'updates', value: updatesText });
    }

    return embed;
};

module.exports = {
    createStatusEmbed,
    createIncidentEmbed,
    STATUS_COLORS
};