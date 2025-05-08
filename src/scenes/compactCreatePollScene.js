const { Markup, Scenes } = require('telegraf')
const Poll = require('../models/Poll')
const logger = require('../utils/logger')

/**
 * Extract mentions from message entities
 * @param {Array} entities - Message entities from Telegram
 * @param {string} text - Full message text
 * @param {number} fromId - User ID of message sender
 * @returns {Array} Array of user mentions
 */
const extractMentions = (entities, text, fromId) => {
	if (!entities) return []

	const mentions = []
	entities.forEach(entity => {
		if (entity.type === 'mention') {
			// Extract username from @mention
			const username = text.substring(
				entity.offset + 1,
				entity.offset + entity.length
			)
			// Generate a temporary negative userId for username mentions
			const tempUserId = -Math.floor(Math.random() * 1000000) - 1
			mentions.push({
				username,
				userId: tempUserId,
				firstName: null,
				lastName: null,
				voted: false,
			})
		} else if (entity.type === 'text_mention' && entity.user) {
			// Text mentions already have user objects
			mentions.push({
				username: entity.user.username || null,
				userId: entity.user.id,
				firstName: entity.user.first_name || null,
				lastName: entity.user.last_name || null,
				voted: entity.user.id === fromId, // Creator is automatically marked as voted
			})
		}
	})

	return mentions
}

/**
 * Create a compact poll creation scene that uses inline keyboard and minimal messages
 * @returns {Scenes.WizardScene} Wizard scene for creating polls
 */
const compactCreatePollScene = () => {
	// Single handler that manages all interactions
	const handleInteraction = async ctx => {
		const { t } = ctx.i18n

		// Initialize state if it's a new scene entry
		if (!ctx.wizard.state.pollData) {
			return await initializeScene(ctx)
		}

		// Process callback queries
		if (ctx.callbackQuery) {
			return await handleCallbackQuery(ctx)
		}

		// Process text messages according to current state
		if (ctx.message && ctx.message.text) {
			return await handleTextInput(ctx)
		}

		// Fallback for unhandled cases
		return
	}

	// Initialize the scene and data structure
	const initializeScene = async ctx => {
		const { t } = ctx.i18n

		// Check if we're initializing from check-voters scene
		const checkData = ctx.scene.state.checkData || {}
		const fromPrivate = checkData.fromPrivate || false

		// Get chat ID either from checkData or current chat
		const chatId = checkData.targetChatId || ctx.chat?.id

		// If in direct command mode (not from checkvoters) and not in group, show error
		if (!fromPrivate && !ctx.isAnyGroup && !checkData.targetChatId) {
			await ctx.reply(t('poll.groupOnly'))
			return ctx.scene.leave()
		}

		// If this is a direct /createpoll command (not from checkVoters), clear any previous checkVoters data
		if (!checkData.fromCheckVoters && ctx.session?.checkVoters) {
			logger.debug('Clearing previous checkVoters data for fresh poll creation')
			ctx.session.checkVoters = {
				chatId: ctx.chat?.id,
				stage: 'initial',
			}
		}

		// Initialize poll data with default state
		ctx.wizard.state.pollData = {
			chatId: chatId,
			creatorId: ctx.from.id,
			options: [],
			state: 'main_menu', // Start at main menu
			currentField: null, // Currently editing field
			editingOption: -1, // Index of option being edited (-1 means none)
			title: '',
			messageId: null, // ID of the main interaction message
			commandMessageId: ctx.message ? ctx.message.message_id : null, // Store original command message ID for cleanup
			fromPrivate: fromPrivate, // Remember if we're in private chat
			fromCheckVoters: !!checkData.importedMentions, // Flag if coming from check-voters
		}

		// If we have imported data from check-voters, let's use it
		if (checkData.importedMentions && checkData.importedMentions.length > 0) {
			ctx.wizard.state.pollData.importedMentions = checkData.importedMentions

			// If we have a suggested title, use it
			if (checkData.suggestedTitle) {
				ctx.wizard.state.pollData.title = checkData.suggestedTitle
			}

			// If we have a selected option, store it for reference
			if (checkData.selectedOption) {
				ctx.wizard.state.pollData.selectedOption = checkData.selectedOption
			}

			// If we have the original poll title, store it for reference
			if (checkData.originalPollTitle) {
				ctx.wizard.state.pollData.originalPollTitle =
					checkData.originalPollTitle
			}
		}

		// Если идем из чекВотерс, сохраняем ID сообщения "Создание опроса..."
		if (checkData.creatingPollMessageId) {
			ctx.wizard.state.pollData.creatingPollMessageId =
				checkData.creatingPollMessageId
		}

		// Delete original command message if available
		if (ctx.message) {
			try {
				await ctx.deleteMessage(ctx.message.message_id)
			} catch (error) {
				logger.warn(
					'Could not delete original /createpoll command message:',
					error
				)
			}
		}

		// Check for imported data from checkVoters scene - support both old and new formats
		if (ctx.scene.state?.checkData) {
			// Old format through scene.state
			if (ctx.scene.state.checkData.importedMentions?.length > 0) {
				ctx.wizard.state.pollData.importedMentions =
					ctx.scene.state.checkData.importedMentions
				ctx.wizard.state.pollData.selectedOption =
					ctx.scene.state.checkData.selectedOption
				ctx.wizard.state.pollData.title = t('scenes.voters.followUpTitle', {
					option: ctx.scene.state.checkData.selectedOption,
				})

				// Save original poll title if available
				if (ctx.scene.state.checkData.originalPollTitle) {
					ctx.wizard.state.pollData.originalPollTitle =
						ctx.scene.state.checkData.originalPollTitle
				}

				// Mark this poll as coming from checkVoters
				ctx.wizard.state.pollData.fromCheckVoters = true
			}

			// Store interface message ID from checkVoters if available
			if (ctx.scene.state.checkData.interfaceMessageId) {
				ctx.wizard.state.pollData.interfaceMessageId =
					ctx.scene.state.checkData.interfaceMessageId
			}

			// Store message ID if available
			if (ctx.scene.state.checkData.messageId) {
				ctx.wizard.state.pollData.originalPollMessageId =
					ctx.scene.state.checkData.messageId
			}
		} else if (ctx.session?.checkVoters) {
			// New format through session
			if (ctx.session.checkVoters.mentionsList?.length > 0) {
				ctx.wizard.state.pollData.importedMentions =
					ctx.session.checkVoters.mentionsList
				ctx.wizard.state.pollData.selectedOption =
					ctx.session.checkVoters.selectedOption
				ctx.wizard.state.pollData.title = t('scenes.voters.followUpTitle', {
					option: ctx.session.checkVoters.selectedOption,
				})

				// Save original poll title if available
				if (
					ctx.session.checkVoters.selectedPollTitle ||
					ctx.session.checkVoters.pollTitle
				) {
					ctx.wizard.state.pollData.originalPollTitle =
						ctx.session.checkVoters.selectedPollTitle ||
						ctx.session.checkVoters.pollTitle
				}

				// Mark this poll as coming from checkVoters
				ctx.wizard.state.pollData.fromCheckVoters = true
			}

			// Store interface message ID from checkVoters if available
			if (ctx.session.checkVoters.interfaceMessageId) {
				ctx.wizard.state.pollData.interfaceMessageId =
					ctx.session.checkVoters.interfaceMessageId
			}

			// Store message ID if available
			if (ctx.session.checkVoters.messageId) {
				ctx.wizard.state.pollData.originalPollMessageId =
					ctx.session.checkVoters.messageId
			}
		} else {
			// For direct /createpoll command, set default title prompt
			ctx.wizard.state.pollData.initialPrompt = true
		}

		// Send initial message with poll creation interface
		const message = await ctx.reply(
			getMainMenuText(ctx),
			Markup.inlineKeyboard(getMainMenuButtons(ctx))
		)

		// Save message ID for future updates
		ctx.wizard.state.pollData.messageId = message.message_id

		return
	}

	// Handle callback queries (button clicks)
	const handleCallbackQuery = async ctx => {
		const { t } = ctx.i18n
		const action = ctx.callbackQuery.data

		// Handle different button actions
		if (action === 'edit_title') {
			return await promptForInput(ctx, 'title')
		} else if (action === 'add_option') {
			return await promptForInput(ctx, 'new_option')
		} else if (action.startsWith('edit_option_')) {
			const optionIndex = parseInt(action.replace('edit_option_', ''), 10)
			return await promptForInput(ctx, 'edit_option', optionIndex)
		} else if (action.startsWith('delete_option_')) {
			const optionIndex = parseInt(action.replace('delete_option_', ''), 10)
			ctx.wizard.state.pollData.options.splice(optionIndex, 1)
			await ctx.answerCbQuery(t('scenes.poll.optionDeleted'))
			return await updateMainMenu(ctx)
		} else if (action === 'create_poll') {
			return await createPoll(ctx)
		} else if (action === 'cancel_creation') {
			await ctx.answerCbQuery(t('scenes.poll.cancelled'))

			logger.debug('Cancel creation action triggered', {
				hasPromptMessage: !!ctx.wizard.state.pollData.promptMessageId,
				hasCreatingPollMessage:
					!!ctx.wizard.state.pollData.creatingPollMessageId,
				messageId: ctx.wizard.state.pollData.messageId,
			})

			// Delete the prompt message if we can find it
			if (ctx.wizard.state.pollData.promptMessageId) {
				await safeDeleteMessage(
					ctx,
					ctx.wizard.state.pollData.promptMessageId,
					'prompt message'
				)
				ctx.wizard.state.pollData.promptMessageId = null
			}

			// Удаляем сообщение "Создание опроса..." из предыдущей сцены, если оно есть
			if (ctx.wizard.state.pollData.creatingPollMessageId) {
				await safeDeleteMessage(
					ctx,
					ctx.wizard.state.pollData.creatingPollMessageId,
					'creating poll message'
				)
				ctx.wizard.state.pollData.creatingPollMessageId = null
			}

			// Delete the current message
			const currentMessageId = ctx.callbackQuery?.message?.message_id
			if (currentMessageId) {
				await safeDeleteMessage(ctx, currentMessageId, 'current message')
			}

			// Set flag to prevent sending cancelledMessage
			ctx.scene.state = ctx.scene.state || {}
			ctx.scene.state.silentLeave = true

			return ctx.scene.leave()
		}

		// Unknown action
		await ctx.answerCbQuery()
	}

	// Handle text input for various fields
	const handleTextInput = async ctx => {
		const { t } = ctx.i18n
		const { currentField, editingOption } = ctx.wizard.state.pollData
		const text = ctx.message.text.trim()

		// Check for cancel command
		if (text === '/cancel') {
			// Clear "waiting for input" state
			ctx.wizard.state.pollData.currentField = null
			ctx.wizard.state.pollData.editingOption = -1

			// Delete the prompt message if we can find it
			if (ctx.wizard.state.pollData.promptMessageId) {
				try {
					await ctx.deleteMessage(ctx.wizard.state.pollData.promptMessageId)
				} catch (error) {
					logger.warn('Could not delete prompt message:', error)
				}
				ctx.wizard.state.pollData.promptMessageId = null
			}

			// Try to delete the user's message
			try {
				await ctx.deleteMessage(ctx.message.message_id)
			} catch (error) {
				logger.warn('Could not delete user message:', error)
			}

			return await updateMainMenu(ctx)
		}

		// Handle input according to current field
		if (currentField === 'title') {
			ctx.wizard.state.pollData.title = text

			// Extract mentions from the title
			if (ctx.message.entities) {
				ctx.wizard.state.pollData.mentions = extractMentions(
					ctx.message.entities,
					ctx.message.text,
					ctx.from.id
				)
			}
		} else if (currentField === 'new_option') {
			ctx.wizard.state.pollData.options.push({
				text: text,
				voterIds: [],
			})
		} else if (currentField === 'edit_option' && editingOption >= 0) {
			ctx.wizard.state.pollData.options[editingOption].text = text
		} else {
			// Unexpected message, ignore
			return
		}

		// Clear "waiting for input" state
		ctx.wizard.state.pollData.currentField = null
		ctx.wizard.state.pollData.editingOption = -1

		// Delete the prompt message if we can find it
		if (ctx.wizard.state.pollData.promptMessageId) {
			try {
				await ctx.deleteMessage(ctx.wizard.state.pollData.promptMessageId)
			} catch (error) {
				logger.warn('Could not delete prompt message:', error)
			}
			ctx.wizard.state.pollData.promptMessageId = null
		}

		// Try to delete the user's message
		try {
			await ctx.deleteMessage(ctx.message.message_id)
		} catch (error) {
			logger.warn('Could not delete user message:', error)
		}

		// Update the main menu
		return await updateMainMenu(ctx)
	}

	// Prompt user for input on a specific field
	const promptForInput = async (ctx, field, optionIndex = -1) => {
		const { t } = ctx.i18n

		// Save current field and option index
		ctx.wizard.state.pollData.currentField = field
		ctx.wizard.state.pollData.editingOption = optionIndex

		// Determine prompt text and placeholder based on field
		let promptText, placeholder

		if (field === 'title') {
			promptText = t('scenes.poll.editTitlePrompt')
			placeholder = t('scenes.poll.titlePlaceholder')
		} else if (field === 'new_option') {
			const optionNumber = ctx.wizard.state.pollData.options.length + 1
			promptText = t('scenes.poll.addOptionPrompt', { count: optionNumber })
			placeholder = t('scenes.poll.optionPlaceholder')
		} else if (field === 'edit_option') {
			const option = ctx.wizard.state.pollData.options[optionIndex]
			promptText = t('scenes.poll.editOptionPrompt', { option: option.text })
			placeholder = option.text
		}

		// Answer the callback query
		await ctx.answerCbQuery()

		// Send prompt message with force_reply
		const message = await ctx.reply(promptText, {
			reply_markup: {
				force_reply: true,
				input_field_placeholder: placeholder,
			},
		})

		// Save prompt message ID for later deletion
		ctx.wizard.state.pollData.promptMessageId = message.message_id
	}

	// Update the main menu message
	const updateMainMenu = async ctx => {
		// Update the main menu message
		await updateMessageText(
			ctx,
			getMainMenuText(ctx),
			Markup.inlineKeyboard(getMainMenuButtons(ctx))
		)
	}

	// Update message text helper
	const updateMessageText = async (ctx, text, extra = {}) => {
		try {
			await ctx.telegram.editMessageText(
				ctx.chat.id,
				ctx.wizard.state.pollData.messageId,
				null,
				text,
				extra
			)
		} catch (error) {
			// Ignore "message is not modified" errors as they're not critical
			if (
				error.description &&
				error.description.includes('message is not modified')
			) {
				logger.debug('Message not modified - content unchanged')
			} else {
				logger.error('Error updating message:', error)
			}
		}
	}

	// Get main menu text based on current state
	const getMainMenuText = ctx => {
		const { t } = ctx.i18n
		const {
			title,
			options,
			mentions,
			importedMentions,
			initialPrompt,
			fromPrivate,
			chatId,
			selectedOption,
			fromCheckVoters,
		} = ctx.wizard.state.pollData

		let text = []

		// If we're in private chat creating a poll for a group, show notice
		if (fromPrivate) {
			text.push(
				`🔄 ${
					t('scenes.poll.creatingInGroup', { chatId }) ||
					`Creating poll in group (${chatId})`
				}`
			)
		}

		// If this is initial prompt from /createpoll, show welcome message
		if (initialPrompt) {
			text.push(`${t('scenes.poll.welcomeCreatePoll')}`)
		}

		// If this poll is created from checkVoters with imported mentions
		if (fromCheckVoters && importedMentions && importedMentions.length > 0) {
			const count = importedMentions.length
			text.push(
				`${t('scenes.poll.usingImportedMentions', {
					count,
					option: selectedOption,
				})}`
			)
		}

		// Poll creation header
		text.push(`📊 ${t('scenes.poll.createPollHeader')}`)

		// Title section
		text.push(
			`\n*${t('scenes.poll.titleSection')}*: ${
				title || t('scenes.poll.notSet')
			}`
		)

		// Options section
		text.push(`\n*${t('scenes.poll.optionsSection')}*:`)
		if (options.length === 0) {
			text.push(t('scenes.poll.noOptions'))
		} else {
			options.forEach((option, index) => {
				text.push(`${index + 1}. ${option.text}`)
			})
		}

		// Mentions section
		const mentionCount =
			(mentions?.length || 0) + (importedMentions?.length || 0)
		if (mentionCount > 0) {
			text.push(
				`\n*${t('scenes.poll.mentionsSection')}*: ${mentionCount} ${
					mentionCount === 1 ? t('poll.user') : t('poll.users')
				}`
			)

			// If from checkVoters, show which option users voted for
			if (selectedOption) {
				text.push(
					`(${
						t('scenes.voters.votedFor', { option: selectedOption }) ||
						`Voted for "${selectedOption}"`
					})`
				)
			}
		}

		// Help text
		text.push(`\n\n${t('scenes.poll.interactiveHelp')}`)

		return text.join('\n')
	}

	// Get main menu buttons based on current state
	const getMainMenuButtons = ctx => {
		const { t } = ctx.i18n
		const { options } = ctx.wizard.state.pollData

		const buttons = []

		// Title edit button
		buttons.push([
			Markup.button.callback(t('scenes.poll.editTitleButton'), 'edit_title'),
		])

		// Option buttons
		if (options.length > 0) {
			// Add option management buttons (2 per row)
			const optionButtons = []
			options.forEach((option, index) => {
				// Create edit button
				const editButton = Markup.button.callback(
					`✏️ ${index + 1}`,
					`edit_option_${index}`
				)

				// Create delete button
				const deleteButton = Markup.button.callback(
					`🗑️ ${index + 1}`,
					`delete_option_${index}`
				)

				// Add both buttons on the same row if even index, otherwise add to existing row
				if (index % 2 === 0) {
					optionButtons.push([editButton, deleteButton])
				} else {
					optionButtons[Math.floor(index / 2)].push(editButton)
					optionButtons[Math.floor(index / 2)].push(deleteButton)
				}
			})

			buttons.push(...optionButtons)
		}

		// Add option button
		if (options.length < 10) {
			// Telegram limit is 10 options
			buttons.push([
				Markup.button.callback(t('scenes.poll.addOptionButton'), 'add_option'),
			])
		}

		// Action buttons
		const actionButtons = []

		// Create poll button (only if we have title and at least 2 options)
		if (ctx.wizard.state.pollData.title && options.length >= 2) {
			actionButtons.push(
				Markup.button.callback(t('scenes.poll.createButton'), 'create_poll')
			)
		}

		// Cancel button
		actionButtons.push(
			Markup.button.callback(t('scenes.poll.cancelButton'), 'cancel_creation')
		)

		buttons.push(actionButtons)

		return buttons
	}

	// Create and send poll
	const createPoll = async ctx => {
		const { t } = ctx.i18n
		const { title, options, mentions, importedMentions, chatId, fromPrivate } =
			ctx.wizard.state.pollData

		// Validation
		if (!title) {
			await ctx.answerCbQuery(t('scenes.poll.titleRequired'))
			return
		}

		if (options.length < 2) {
			await ctx.answerCbQuery(t('scenes.poll.minimumOptionsRequired'))
			return
		}

		await ctx.answerCbQuery(t('scenes.poll.creating'))

		// Update message to show we're creating the poll
		await updateMessageText(ctx, t('scenes.poll.creatingPoll'))

		try {
			// Combine imported mentions with title
			let displayTitle = title
			let mentionsString = null

			if (importedMentions && importedMentions.length > 0) {
				mentionsString = importedMentions.join(' ')
			}

			// Check if this poll is from checkVoters
			const fromCheckVoters = ctx.wizard.state.pollData.fromCheckVoters === true

			// Send the poll to the appropriate chat
			// If fromPrivate is true, use telegram.sendPoll to target the specific chat
			let pollMessage
			if (fromPrivate) {
				pollMessage = await ctx.telegram.sendPoll(
					chatId, // Use the stored chatId from the group
					displayTitle,
					options.map(o => o.text),
					{
						is_anonymous: false,
						allows_multiple_answers: false,
					}
				)

				// Notify the user in private chat that poll was created in the group
				await ctx.reply(
					t('scenes.poll.pollCreatedInGroup', { chatId }) ||
						`Poll was created in the group (${chatId}). Check the group to see your poll.`
				)
			} else {
				// Standard behavior when in a group chat
				pollMessage = await ctx.replyWithPoll(
					displayTitle,
					options.map(o => o.text),
					{
						is_anonymous: false,
						allows_multiple_answers: false,
					}
				)
			}

			// Send mentions in a separate message if needed
			if (mentionsString) {
				// Use different message template based on whether this poll is from checkVoters
				const messageKey =
					ctx.wizard.state.pollData.fromCheckVoters === true
						? 'scenes.poll.mentionsForCheckVoters'
						: 'scenes.poll.mentionsForPoll'

				const mentionsMessage = t(messageKey, {
					messageId: pollMessage.message_id,
					mentions: mentionsString,
					option: ctx.wizard.state.pollData.selectedOption || '',
					title: displayTitle,
					originalPollTitle:
						ctx.wizard.state.pollData.originalPollTitle || 'Untitled Poll',
				})

				if (fromPrivate) {
					// Send to the group chat
					await ctx.telegram.sendMessage(chatId, mentionsMessage)
					// Also show to the user
					await ctx.reply(mentionsMessage)
				} else {
					await ctx.reply(mentionsMessage)
				}
			}

			// Always save to database, but mark polls created from checkVoters
			{
				const combinedMentions = [...(mentions || [])]

				const poll = new Poll({
					chatId: chatId, // Use the stored chatId which might be different from ctx.chat.id
					messageId: pollMessage.message_id,
					pollId: pollMessage.poll.id,
					creatorId: ctx.from.id,
					title: displayTitle,
					options: options,
					mentions: combinedMentions,
					isAnonymous: false,
					isMultipleChoice: false,
					fromCheckVoters: fromCheckVoters, // Add flag to mark polls created from checkVoters
				})

				// Try to save the poll
				try {
					await poll.save()
				} catch (saveError) {
					logger.error('Error saving poll to database:', saveError)
					// Try to save without mentions if that's causing the problem
					if (
						saveError.name === 'ValidationError' &&
						saveError.message.includes('mentions')
					) {
						poll.mentions = []
						await poll.save()
						logger.info('Saved poll without mentions due to validation error')
					} else {
						throw saveError // Re-throw if it's not a mentions validation error
					}
				}

				// Log the source of the poll creation
				if (fromCheckVoters) {
					logger.info('Poll created from checkVoters with special flag')
				}
			}

			// Сохраняем идентификаторы всех сообщений, которые нужно удалить
			const messagesToDelete = []

			// 1. Удаляем основное сообщение интерфейса
			if (ctx.wizard.state.pollData.messageId) {
				messagesToDelete.push({
					id: ctx.wizard.state.pollData.messageId,
					description: 'main interface message',
				})
			}

			// 2. Удаляем сообщение интерфейса из checkVoters
			if (ctx.wizard.state.pollData.interfaceMessageId) {
				messagesToDelete.push({
					id: ctx.wizard.state.pollData.interfaceMessageId,
					description: 'checkVoters interface message',
				})
			}

			// 3. Удаляем сообщение "Создание опроса..." из предыдущей сцены
			if (ctx.wizard.state.pollData.creatingPollMessageId) {
				messagesToDelete.push({
					id: ctx.wizard.state.pollData.creatingPollMessageId,
					description: 'creating poll message',
				})
			}

			// Запускаем удаление всех сообщений одновременно
			await Promise.all(
				messagesToDelete.map(msg =>
					safeDeleteMessage(ctx, msg.id, msg.description)
				)
			).catch(error => {
				logger.warn('Error during batch message deletion:', error)
			})

			// Set flag to prevent sending cancelledMessage on exit
			ctx.scene.state = ctx.scene.state || {}
			ctx.scene.state.silentLeave = true

			// Exit the scene without sending additional messages
			return ctx.scene.leave()
		} catch (error) {
			logger.error('Error creating poll:', error)
			await updateMessageText(ctx, t('poll.createError'))

			// Сохраняем идентификаторы всех сообщений, которые нужно удалить
			const messagesToDelete = []

			// Даем пользователю время увидеть сообщение об ошибке
			setTimeout(async () => {
				// Удаляем сообщение с ошибкой
				if (ctx.wizard.state.pollData.messageId) {
					await safeDeleteMessage(
						ctx,
						ctx.wizard.state.pollData.messageId,
						'error message'
					)
				}

				// Удаляем сообщение "Создание опроса..." из предыдущей сцены
				if (ctx.wizard.state.pollData.creatingPollMessageId) {
					await safeDeleteMessage(
						ctx,
						ctx.wizard.state.pollData.creatingPollMessageId,
						'creating poll message'
					)
				}
			}, 3000) // Пауза 3 секунды, чтобы пользователь мог прочитать сообщение об ошибке

			// Even on error, we don't want to send the cancelledMessage
			ctx.scene.state = ctx.scene.state || {}
			ctx.scene.state.silentLeave = true

			return ctx.scene.leave()
		}
	}

	// Вспомогательная функция для безопасного удаления сообщений
	const safeDeleteMessage = async (ctx, messageId, description = 'message') => {
		if (!messageId) return false

		try {
			logger.debug(`Attempting to delete ${description}:`, { messageId })
			await ctx.deleteMessage(messageId)
			return true
		} catch (error) {
			// Игнорируем ошибки "message to delete not found", это означает, что сообщение уже удалено
			if (
				error.description &&
				error.description.includes('message to delete not found')
			) {
				logger.debug(`${description} already deleted or not found:`, {
					messageId,
				})
			} else {
				logger.warn(`Could not delete ${description}:`, error)
			}
			return false
		}
	}

	// Create the wizard scene with a single handler
	// Create scene with a single step
	const scene = new Scenes.WizardScene('compact-create-poll', handleInteraction)

	// Add leave middleware to handle silent leave
	scene.leave((ctx, next) => {
		// Log scene state for debugging
		logger.debug('Leaving compact-create-poll scene', {
			hasSceneState: !!ctx.scene.state,
			silentLeave: ctx.scene.state?.silentLeave,
			sceneState: JSON.stringify(ctx.scene.state || {}),
			wizardState: JSON.stringify(ctx.wizard?.state || {}),
		})

		// Попытки удалить все оставшиеся сообщения
		const messagesToDelete = []

		// 1. Удаляем сообщение с приглашением ввести данные
		if (ctx.wizard?.state?.pollData?.promptMessageId) {
			messagesToDelete.push({
				id: ctx.wizard.state.pollData.promptMessageId,
				description: 'prompt message',
			})
		}

		// 2. Удаляем основное сообщение интерфейса создания опроса
		if (ctx.wizard?.state?.pollData?.messageId) {
			messagesToDelete.push({
				id: ctx.wizard.state.pollData.messageId,
				description: 'main interface message',
			})
		}

		// 3. Удаляем сообщение "Создание опроса..." из предыдущей сцены
		if (ctx.wizard?.state?.pollData?.creatingPollMessageId) {
			messagesToDelete.push({
				id: ctx.wizard.state.pollData.creatingPollMessageId,
				description: 'creating poll message',
			})
		}

		// Запускаем удаление всех сообщений одновременно
		Promise.all(
			messagesToDelete.map(msg =>
				safeDeleteMessage(ctx, msg.id, msg.description)
			)
		).catch(error => {
			logger.warn('Error during batch message deletion:', error)
		})

		if (ctx.scene.state?.silentLeave) {
			// Skip sending leave message
			return next()
		}

		// Default leave behavior would continue here
		const { t } = ctx.i18n
		ctx.reply(t('scenes.poll.cancelledMessage'))
		return next()
	})

	return scene
}

module.exports = compactCreatePollScene
