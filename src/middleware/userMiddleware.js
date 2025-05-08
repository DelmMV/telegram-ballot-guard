/**
 * Middleware for handling user information
 * @module middleware/userMiddleware
 */

/**
 * Middleware that enhances context with user information
 * @param {import('telegraf').Context} ctx - Telegraf context
 * @param {Function} next - Next middleware function
 */
const userMiddleware = async (ctx, next) => {
  if (!ctx.from) {
    return await next();
  }
  
  // Add formatted user name to context
  ctx.userName = getUserName(ctx.from);
  
  // Add user mention method to context
  ctx.mentionUser = (user) => {
    if (!user) {
      user = ctx.from;
    }
    
    const name = getUserName(user);
    if (user.username) {
      return `@${user.username}`;
    } else {
      return `[${name}](tg://user?id=${user.id})`;
    }
  };
  
  return await next();
};

/**
 * Get formatted user name from user object
 * @param {Object} user - Telegram user object
 * @returns {string} Formatted user name
 */
const getUserName = (user) => {
  if (!user) {
    return 'Unknown User';
  }
  
  if (user.username) {
    return user.username;
  }
  
  let name = user.first_name || '';
  if (user.last_name) {
    name += ` ${user.last_name}`;
  }
  
  return name.trim() || `User${user.id}`;
};

module.exports = {
  userMiddleware
};