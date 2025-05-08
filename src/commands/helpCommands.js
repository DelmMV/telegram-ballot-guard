const logger = require('../utils/logger');

/**
 * Register help-related commands
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 */
const registerHelpCommands = (bot) => {
  // Start command
  bot.command('start', async (ctx) => {
    await sendWelcomeMessage(ctx);
  });
  
  // Help command
  bot.command('help', async (ctx) => {
    await sendHelpMessage(ctx);
  });
};

/**
 * Send welcome message to new users
 * @param {import('telegraf').Context} ctx - Telegraf context
 */
const sendWelcomeMessage = async (ctx) => {
  try {
    const { t } = ctx.i18n;
    
    const message = 
      `👋 ${t('common.welcome')}\n\n` +
      `${t('welcome.description')}\n\n` +
      `🔹 *${t('welcome.groupUsage')}*\n` +
      `🔹 *${t('welcome.privateUsage')}*\n\n` +
      `${t('welcome.seeCommands')}`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
    // If in private chat, follow up with help
    if (ctx.chat.type === 'private') {
      await sendHelpMessage(ctx);
    }
  } catch (error) {
    logger.error('Error sending welcome message:', error);
  }
};

/**
 * Send help message with commands information
 * @param {import('telegraf').Context} ctx - Telegraf context
 */
const sendHelpMessage = async (ctx) => {
  try {
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const { t } = ctx.i18n;
    
    let message = `📋 *${t('help.title')}*\n\n`;
    
    // Common commands
    message += `🔸 ${t('help.commonCommands.help')}\n\n`;
    
    // Group-specific commands
    if (isGroup) {
      message += 
        `*${t('help.groupCommands.title')}*\n` +
        `🔸 ${t('help.groupCommands.newpoll')}\n\n` +
        `🔸 ${t('help.groupCommands.createpoll')}\n\n` +
        
        `*${t('help.groupCommands.managingTitle')}*\n` +
        `🔸 ${t('help.groupCommands.checkvoters')}\n`;
    } else {
      // Private chat help
      message += 
        `${t('help.privateCommands.description')}\n\n` +
        `🔸 ${t('help.privateCommands.newpoll')}\n` +
        `🔸 ${t('help.privateCommands.createpoll')}\n` +
        `🔸 ${t('help.privateCommands.checkvoters')}\n\n` +
        `${t('help.privateCommands.trackingInfo')}`;
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error sending help message:', error);
  }
};

module.exports = {
  registerHelpCommands
};