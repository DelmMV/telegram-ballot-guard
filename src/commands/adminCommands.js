const logger = require('../utils/logger');

/**
 * Register admin-related commands
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 */
const registerAdminCommands = (bot) => {
  // Stats command for bot owner/admins
  bot.command('stats', async (ctx) => {
    // Only allow in private chat
    if (ctx.chat.type !== 'private') {
      return;
    }
    
    // Check if user is the bot owner (you would set this in environment variables)
    const ownerId = parseInt(process.env.BOT_OWNER_ID, 10);
    if (ctx.from.id !== ownerId) {
      return ctx.reply('This command is only available to the bot owner.');
    }
    
    try {
      const Poll = require('../models/Poll');
      
      // Get statistics from database
      const totalPolls = await Poll.countDocuments();
      const activePolls = await Poll.countDocuments({ isClosed: false });
      const totalChats = await Poll.distinct('chatId').then(chats => chats.length);
      
      // Top active chats
      const topChats = await Poll.aggregate([
        { $group: { _id: '$chatId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]);
      
      let topChatsText = '';
      for (const chat of topChats) {
        try {
          const chatInfo = await ctx.telegram.getChat(chat._id);
          const chatName = chatInfo.title || `Chat ID: ${chat._id}`;
          topChatsText += `\n- ${chatName}: ${chat.count} polls`;
        } catch (error) {
          topChatsText += `\n- Chat ID ${chat._id}: ${chat.count} polls (can't access chat info)`;
        }
      }
      
      const statsMessage = 
        `📊 *Bot Statistics*\n\n` +
        `Total polls created: ${totalPolls}\n` +
        `Active polls: ${activePolls}\n` +
        `Total chats: ${totalChats}\n\n` +
        `Top active chats:${topChatsText || '\nNo data available'}`;
        
      await ctx.reply(statsMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error getting bot stats:', error);
      await ctx.reply('Failed to get bot statistics.');
    }
  });
  
  // Debug command for bot owner
  bot.command('debug', async (ctx) => {
    // Only allow in private chat
    if (ctx.chat.type !== 'private') {
      return;
    }
    
    // Check if user is the bot owner
    const ownerId = parseInt(process.env.BOT_OWNER_ID, 10);
    if (ctx.from.id !== ownerId) {
      return ctx.reply('This command is only available to the bot owner.');
    }
    
    const args = ctx.message.text.split(/\s+/).slice(1);
    const subcommand = args[0];
    
    if (!subcommand) {
      return ctx.reply(
        'Available debug commands:\n' +
        '/debug chat <chat_id> - Get info about a chat\n' +
        '/debug poll <poll_id> - Get info about a poll\n' +
        '/debug memory - Show memory usage'
      );
    }
    
    try {
      switch (subcommand) {
        case 'memory': {
          const memoryUsage = process.memoryUsage();
          const formatMemory = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';
          
          const message = 
            '📊 *Memory Usage*\n\n' +
            `RSS: ${formatMemory(memoryUsage.rss)}\n` +
            `Heap Total: ${formatMemory(memoryUsage.heapTotal)}\n` +
            `Heap Used: ${formatMemory(memoryUsage.heapUsed)}\n` +
            `External: ${formatMemory(memoryUsage.external)}`;
            
          await ctx.reply(message, { parse_mode: 'Markdown' });
          break;
        }
        
        case 'chat': {
          const chatId = args[1];
          if (!chatId) {
            return ctx.reply('Please provide a chat ID');
          }
          
          // Get information about the chat
          try {
            const chatInfo = await ctx.telegram.getChat(chatId);
            const chatInfoStr = JSON.stringify(chatInfo, null, 2);
            
            if (chatInfoStr.length <= 4000) {
              await ctx.reply(`Chat info for ${chatId}:\n\`\`\`\n${chatInfoStr}\n\`\`\``, { parse_mode: 'Markdown' });
            } else {
              await ctx.reply('Chat info is too long to display');
            }
          } catch (error) {
            await ctx.reply(`Error getting chat info: ${error.message}`);
          }
          break;
        }
        
        case 'poll': {
          const pollId = args[1];
          if (!pollId) {
            return ctx.reply('Please provide a poll ID');
          }
          
          const Poll = require('../models/Poll');
          const poll = await Poll.findById(pollId);
          
          if (!poll) {
            return ctx.reply(`Poll not found with ID: ${pollId}`);
          }
          
          const pollInfoStr = JSON.stringify(poll.toObject(), null, 2);
          
          if (pollInfoStr.length <= 4000) {
            await ctx.reply(`Poll info for ${pollId}:\n\`\`\`\n${pollInfoStr}\n\`\`\``, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply('Poll info is too long to display');
          }
          break;
        }
        
        default:
          await ctx.reply(`Unknown debug command: ${subcommand}`);
      }
    } catch (error) {
      logger.error('Error executing debug command:', error);
      await ctx.reply(`Error: ${error.message}`);
    }
  });
};

module.exports = {
  registerAdminCommands
};