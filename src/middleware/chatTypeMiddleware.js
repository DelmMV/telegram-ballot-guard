/**
 * Middleware to identify and handle different chat types
 * @module middleware/chatTypeMiddleware
 */

/**
 * Middleware that adds chat type flags to context
 * @param {import('telegraf').Context} ctx - Telegraf context
 * @param {Function} next - Next middleware function
 */
const chatTypeMiddleware = async (ctx, next) => {
  if (!ctx.chat) {
    return await next();
  }

  // Add chat type convenience properties
  ctx.isPrivate = ctx.chat.type === 'private';
  ctx.isGroup = ctx.chat.type === 'group';
  ctx.isSupergroup = ctx.chat.type === 'supergroup';
  ctx.isChannel = ctx.chat.type === 'channel';
  
  // Grouped property for any group chat type
  ctx.isAnyGroup = ctx.isGroup || ctx.isSupergroup;
  
  // Add admin check method for groups
  ctx.isAdmin = async (userId) => {
    if (!ctx.isAnyGroup && !ctx.isChannel) {
      return false;
    }
    
    const user = userId || ctx.from?.id;
    if (!user) {
      return false;
    }
    
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, user);
      return ['creator', 'administrator'].includes(member.status);
    } catch (error) {
      return false;
    }
  };
  
  return await next();
};

module.exports = {
  chatTypeMiddleware
};