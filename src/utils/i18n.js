/**
 * Internationalization (i18n) utility
 * Manages translations and language detection for the bot
 * @module utils/i18n
 */

const en = require('../locales/en');
const ru = require('../locales/ru');
const logger = require('./logger');

// Available locales
const locales = {
  en,
  ru
};

// Default locale
const DEFAULT_LOCALE = 'en';

/**
 * Format a message with variables
 * @param {string} message - Message with placeholders
 * @param {Object} [variables] - Variables to insert
 * @returns {string} Formatted message
 */
const formatMessage = (message, variables = {}) => {
  if (!message) return '';
  if (!variables || Object.keys(variables).length === 0) return message;

  return message.replace(/{(\w+)}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
};

/**
 * Detect user's language preference from Telegram context
 * @param {import('telegraf').Context} ctx - Telegraf context
 * @returns {string} Detected language code (en or ru)
 */
const detectLanguage = (ctx) => {
  try {
    // First try to get language from user settings
    const userLanguage = ctx.from?.language_code || '';
    
    // If it's Russian or any variation, use Russian
    if (userLanguage.toLowerCase().startsWith('ru')) {
      return 'ru';
    }
    
    // Use English for everything else
    return 'en';
  } catch (error) {
    logger.error('Error detecting language:', error);
    return DEFAULT_LOCALE;
  }
};

/**
 * Get translation by key and language
 * @param {string} key - Dot notation path to translation (e.g. 'common.welcome')
 * @param {string} lang - Language code
 * @param {Object} [variables] - Variables to replace in the message
 * @returns {string} Translated message
 */
const getTranslation = (key, lang, variables = {}) => {
  try {
    // Make sure we have a valid language
    const locale = locales[lang] || locales[DEFAULT_LOCALE];
    
    // Navigate to the nested property using the key
    const keyParts = key.split('.');
    let translation = locale;
    
    for (const part of keyParts) {
      translation = translation[part];
      if (translation === undefined) {
        logger.warn(`Translation key not found: ${key} (language: ${lang})`);
        
        // Try to get from default locale as fallback
        if (lang !== DEFAULT_LOCALE) {
          return getTranslation(key, DEFAULT_LOCALE, variables);
        }
        
        return key; // Return the key as last resort
      }
    }
    
    // Format the message with variables
    return formatMessage(translation, variables);
  } catch (error) {
    logger.error(`Error getting translation for key ${key}:`, error);
    return key;
  }
};

/**
 * Creates a translator function for the given language
 * @param {string} lang - Language code
 * @returns {Function} Translator function
 */
const createTranslator = (lang) => {
  return (key, variables) => getTranslation(key, lang, variables);
};

/**
 * Middleware to add translation function to context
 * @param {import('telegraf').Context} ctx - Telegraf context
 * @param {Function} next - Next middleware
 */
const i18nMiddleware = async (ctx, next) => {
  const lang = detectLanguage(ctx);
  ctx.i18n = {
    locale: lang,
    t: createTranslator(lang)
  };
  return next();
};

module.exports = {
  detectLanguage,
  getTranslation,
  createTranslator,
  i18nMiddleware,
  DEFAULT_LOCALE,
  locales
};