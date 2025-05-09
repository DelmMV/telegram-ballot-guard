const { Markup, Scenes } = require('telegraf')
const Poll = require('../models/Poll')
const logger = require('../utils/logger')

/**
 * Create a single-step voters checking scene
 * @returns {Scenes.WizardScene} Wizard scene for checking voters
 */
const checkVotersScene = () => {
	// Main handler function that processes callback queries
	// Handle callback action for all steps
	const handleCallback = async ctx => {
		// Ensure context object exists
		if (!ctx) {
			logger.error('Missing context object in handleCallback')
			return
		}

		try {
			const { t } = ctx.i18n || { t: key => key }

			// Initialize session data if needed
			ctx.session = ctx.session || {}
			ctx.session.checkVoters = ctx.session.checkVoters || {
				chatId: ctx.chat?.id,
				stage: 'initial',
				messageId: null, // Store message ID for poll
				pollId: null, // Store poll ID
				optionIndex: -1, // Store selected option index
			}

			// Initialize scene state for leave handling
			ctx.scene.state = ctx.scene.state || {}

			logger.debug('checkVotersScene handleCallback', {
				hasCallbackQuery: !!ctx.callbackQuery,
				hasSession: !!ctx.session,
				sessionData: JSON.stringify(ctx.session.checkVoters),
				chat: ctx.chat?.id,
			})

			// Only process callback queries
			if (!ctx.callbackQuery) {
				// If called via command, initialize the scene
				if (
					ctx.message &&
					ctx.message.text &&
					ctx.message.text.startsWith('/checkvoters')
				) {
					return await initializeScene(ctx)
				}
				return // Ignore other types of messages
			}
		} catch (error) {
			logger.error('Error in handleCallback initialization:', error)
			return
		}

		// Safely get the action data
		const action = ctx.callbackQuery?.data

		if (!action) {
			logger.warn('Missing action data in callback query')
			try {
				await ctx.answerCbQuery('Error: Invalid action')
			} catch (error) {
				logger.error('Could not answer callback query:', error)
			}
			return
		}

		// Cancel action - exit the scene
		// Handle cancel action
		if (action === 'cancel_check') {
			try {
				const { t } = ctx.i18n || { t: key => key }
				await ctx.answerCbQuery(t('scenes.voters.cancelled'))

				// Delete the creating poll message if it exists
				if (ctx.session?.checkVoters?.creatingPollMessageId) {
					await safeDeleteMessage(
						ctx,
						ctx.session.checkVoters.creatingPollMessageId,
						'creating poll message'
					)
					ctx.session.checkVoters.creatingPollMessageId = null
				}

				// Delete the message instead of sending a new one
				try {
					await ctx.deleteMessage()
				} catch (error) {
					logger.warn('Could not delete message on cancel:', error)
				}
				// Set flag to prevent sending cancelledMessage
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			} catch (error) {
				logger.error('Error handling cancel action:', error)
				return
			}
		}

		// Finish action - exit the scene
		if (action === 'finish_check') {
			try {
				await ctx.answerCbQuery()

				// Delete the creating poll message if it exists
				if (ctx.session?.checkVoters?.creatingPollMessageId) {
					await safeDeleteMessage(
						ctx,
						ctx.session.checkVoters.creatingPollMessageId,
						'creating poll message'
					)
					ctx.session.checkVoters.creatingPollMessageId = null
				}

				// Delete the message instead of sending a new one
				try {
					await ctx.deleteMessage()
				} catch (error) {
					logger.warn('Could not delete message on finish:', error)
				}
				// Set flag to prevent sending cancelledMessage
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			} catch (error) {
				logger.error('Error handling finish action:', error)
				return
			}
		}

		// Create poll with users action
		if (action === 'create_poll_with_users') {
			try {
				return await handleCreatePoll(ctx)
			} catch (error) {
				logger.error('Error handling create poll action:', error)
				return
			}
		}

		// Poll selection action
		if (action.startsWith('poll_') && action !== 'poll_info') {
			try {
				return await handlePollSelection(ctx, action)
			} catch (error) {
				logger.error('Error handling poll selection action:', error)
				return
			}
		}

		// Option selection action
		if (action.startsWith('option_')) {
			try {
				return await handleOptionSelection(ctx, action)
			} catch (error) {
				logger.error('Error handling option selection action:', error)
				return
			}
		}

		// Poll info action (does nothing, just prevents error)
		if (action === 'poll_info') {
			await ctx.answerCbQuery()
			return
		}

		// Polls pagination - previous page
		if (action === 'polls_page_prev') {
			try {
				await ctx.answerCbQuery()
				// Ensure we have a valid session
				ctx.session.checkVoters = ctx.session.checkVoters || {}

				// Get current page and log it
				const currentPage = ctx.session.checkVoters.pollsPage || 0

				// Only paginate if we have more than 5 polls
				const totalItems = ctx.session.checkVoters.availablePolls
					? ctx.session.checkVoters.availablePolls.length
					: 0

				if (totalItems <= 5) {
					return await showPolls(ctx)
				}

				logger.debug('Polls pagination: moving from page', {
					current: currentPage,
					direction: 'prev',
				})

				// Decrement page counter if not already at the first page
				if (currentPage > 0) {
					ctx.session.checkVoters.pollsPage = currentPage - 1
				}

				// Show polls with the updated page
				return await showPolls(ctx)
			} catch (error) {
				logger.error('Error handling polls_page_prev action:', error)
				return
			}
		}

		// Polls pagination - next page
		if (action === 'polls_page_next') {
			try {
				await ctx.answerCbQuery()
				// Ensure we have a valid session
				ctx.session.checkVoters = ctx.session.checkVoters || {}

				// Get current page
				const currentPage = ctx.session.checkVoters.pollsPage || 0

				// Calculate number of pages based on polls count
				const itemsPerPage = 5 // Show 5 polls per page
				const totalItems = ctx.session.checkVoters.availablePolls
					? ctx.session.checkVoters.availablePolls.length
					: 0

				// Only paginate if we have more than 5 polls
				if (totalItems <= 5) {
					return await showPolls(ctx)
				}

				const totalPages = Math.ceil(totalItems / itemsPerPage)

				logger.debug('Polls pagination: moving from page', {
					current: currentPage,
					direction: 'next',
					totalPages: totalPages,
					totalItems: totalItems,
				})

				// Increment page counter if not already at the last page
				if (currentPage < totalPages - 1) {
					ctx.session.checkVoters.pollsPage = currentPage + 1
				}

				// Show polls with the updated page
				return await showPolls(ctx)
			} catch (error) {
				logger.error('Error handling polls_page_next action:', error)
				return
			}
		}

		// Back to polls action
		if (action === 'back_to_polls') {
			try {
				logger.debug('Handling back_to_polls action', {
					sessionData: JSON.stringify(ctx.session?.checkVoters || {}),
					callbackData: action,
				})

				// Answer callback query to provide visual feedback
				try {
					await ctx.answerCbQuery('Returning to poll list...')
				} catch (cbError) {
					logger.warn('Could not answer callback query:', cbError)
				}

				// Reset stage to poll selection
				ctx.session.checkVoters = ctx.session.checkVoters || {}
				ctx.session.checkVoters.stage = 'select_poll'

				// Get localization in outer scope
				const { t } = ctx.i18n || { t: key => key }

				logger.debug('Redisplaying poll list directly')

				// Create a simplified approach
				try {
					// Create basic poll list message
					const messageText = t('scenes.voters.selectPoll')

					// Create a simple cancel button
					const keyboard = Markup.inlineKeyboard([
						[
							Markup.button.callback(
								t('scenes.voters.cancelButton'),
								'cancel_check'
							),
						],
					])

					// Update the message first
					await ctx.editMessageText(messageText, keyboard)

					// Then let showPolls function handle the complete refresh
					return await showPolls(ctx)
				} catch (displayError) {
					logger.error('Error displaying simplified poll list:', displayError)
					try {
						// Last resort - try to update message with minimal content
						await ctx.editMessageText(
							'Loading poll list...',
							Markup.inlineKeyboard([
								[Markup.button.callback('Cancel', 'cancel_check')],
							])
						)
					} catch (finalError) {
						logger.error('Failed final attempt to update message:', finalError)
					}
					return
				}
			} catch (error) {
				logger.error('Error handling back to polls action:', error, {
					errorName: error.name,
					errorMessage: error.message,
					stack: error.stack,
				})

				// Try to provide feedback to user
				try {
					await ctx.answerCbQuery('Error returning to poll list')
				} catch (cbError) {
					logger.warn('Could not answer callback query:', cbError)
				}
				return
			}
		}

		// Обработчики пагинации удалены, так как пагинация больше не используется

		// Обработчики информации о пагинации удалены

		// Unknown action
		await ctx.answerCbQuery()
		logger.debug('Unknown action received', {
			action,
			stage: ctx.session.checkVoters?.stage,
		})
	}

	// Initialize the scene - show available polls
	const initializeScene = async ctx => {
		// Ensure we have a context object
		if (!ctx) {
			logger.error('Missing context object in initializeScene')
			return
		}

		const { t } = ctx.i18n || { t: key => key }

		// Reset polls pagination to first page
		if (ctx.session && ctx.session.checkVoters) {
			ctx.session.checkVoters.pollsPage = 0
		}

		// Get chat ID either from the scene state (private chat) or from the current chat (group)
		let chatId = null
		let fromPrivate = false
		let messageId = null

		// Initialize scene state
		ctx.scene.state = ctx.scene.state || {}

		// Check if we have user polls from previous scene
		if (ctx.scene.state.userPolls && Array.isArray(ctx.scene.state.userPolls)) {
			// We have user polls from private chat, no need for group ID
			fromPrivate = true

			logger.debug(
				'Initializing checkVoters from private chat with user polls',
				{
					pollsCount: ctx.scene.state.userPolls.length,
					userId: ctx.from?.id,
				}
			)

			// Extract chatId from the first poll if available for future use
			if (
				ctx.scene.state.userPolls.length > 0 &&
				ctx.scene.state.userPolls[0].chatId
			) {
				chatId = ctx.scene.state.userPolls[0].chatId
			}
		}
		// Check if we have state data from previous scene with group ID
		else if (
			ctx.scene.state.groupId &&
			!isNaN(parseInt(ctx.scene.state.groupId, 10))
		) {
			// Command was invoked from private chat with groupId parameter
			chatId = ctx.scene.state.groupId
			fromPrivate = true

			// If message ID is provided, store it for later
			if (ctx.scene.state.messageId) {
				messageId = ctx.scene.state.messageId
			}

			logger.debug('Initializing checkVoters from private chat', {
				groupId: chatId,
				messageId: messageId,
				userId: ctx.from?.id,
			})
		} else if (ctx.message && ctx.message.text) {
			// Check if command is used with parameters
			const args = ctx.message.text.split(/\s+/).slice(1)

			// If we have args and we're in private chat, try to parse group_id
			if (args.length > 0 && !ctx.isAnyGroup) {
				const parsedGroupId = parseInt(args[0], 10)

				if (!isNaN(parsedGroupId)) {
					// Valid group ID from command line
					chatId = parsedGroupId
					fromPrivate = true

					// Check if message_id is provided
					if (args.length > 1 && /^\d+$/.test(args[1])) {
						messageId = parseInt(args[1], 10)
					}

					logger.debug('Initializing checkVoters from command with params', {
						groupId: chatId,
						messageId: messageId,
						userId: ctx.from?.id,
					})
				} else {
					// Invalid group ID
					await ctx.reply(
						t('poll.invalidGroupId') ||
							'Invalid group ID. Please provide a valid group ID.'
					)
					ctx.scene.state.silentLeave = true
					return ctx.scene.leave()
				}
			} else if (!ctx.isAnyGroup) {
				// In private chat without valid parameters
				await ctx.reply(
					t('poll.privateCheckHelp') ||
						'To check poll in private chat, use format: /checkvoters <group_id> [message_id]'
				)
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			} else {
				// In group chat without parameters - use current chat
				chatId = ctx.chat.id

				logger.debug('Initializing checkVoters in group chat', {
					chatId: chatId,
					userId: ctx.from?.id,
				})
			}
		} else {
			// Command was invoked directly in a group chat
			// Check if command is used in group or supergroup
			if (!ctx.isAnyGroup) {
				await ctx.reply(
					t('poll.privateCheckHelp') ||
						'To check poll in private chat, use format: /checkvoters <group_id> [message_id]'
				)
				// Set flag to prevent sending cancelledMessage
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			}

			chatId = ctx.chat.id

			logger.debug('Initializing checkVoters in group chat', {
				chatId: chatId,
				userId: ctx.from?.id,
			})
		}

		// Initialize session data
		ctx.session.checkVoters = {
			chatId: chatId || ctx.chat?.id || null,
			fromPrivate: fromPrivate,
			stage: 'select_poll', // Track current stage of the flow
			specificMessageId: messageId, // Store specific message ID if provided
			userPolls: ctx.scene.state.userPolls, // Store user polls if available
		}

		// Log session initialization
		logger.debug('Initialized checkVoters session', {
			chatId: ctx.session.checkVoters.chatId,
			fromPrivate: fromPrivate,
			hasUserPolls: !!ctx.scene.state.userPolls,
			hasMessageId: !!messageId,
		})

		// Store command message ID for later deletion
		if (ctx.message) {
			ctx.session.checkVoters.commandMessageId = ctx.message.message_id

			// Try to delete the original command message if in group chat
			if (!fromPrivate) {
				try {
					await ctx.deleteMessage(ctx.message.message_id)
				} catch (error) {
					logger.warn(
						'Could not delete original /checkvoters command message:',
						error
					)
				}
			}
		}

		// Show polls
		return await showPolls(ctx)
	}

	// Helper to show available polls
	const showPolls = async ctx => {
		// Ensure context exists
		if (!ctx) {
			logger.error('Missing context object in showPolls')
			return
		}

		logger.debug('Entering showPolls function', {
			hasContext: !!ctx,
			hasSession: !!ctx.session,
			sessionData: JSON.stringify(ctx.session?.checkVoters || {}),
		})

		// Force session update to prevent desync
		try {
			ctx.scene.session = Object.assign({}, ctx.scene.session || {})
			ctx.session = Object.assign({}, ctx.session || {})
		} catch (error) {
			logger.warn('Error forcing session update:', error)
		}

		const { t } = ctx.i18n || { t: key => key }

		try {
			// Update the current stage
			ctx.session.checkVoters = ctx.session.checkVoters || {}
			ctx.session.checkVoters.stage = 'select_poll'

			// Инициализировать страницу списка опросов, если не задана
			if (typeof ctx.session.checkVoters.pollsPage !== 'number') {
				ctx.session.checkVoters.pollsPage = 0
			}

			// Ensure we have a chatId
			if (!ctx.session.checkVoters.chatId && ctx.chat) {
				ctx.session.checkVoters.chatId = ctx.chat.id
			}

			const chatId = ctx.session.checkVoters.chatId

			// If we still don't have a chatId and don't have userPolls, we can't proceed
			if (!chatId && !ctx.session.checkVoters.userPolls) {
				logger.error('No chatId available for showPolls')
				try {
					await ctx.reply(
						t('poll.invalidGroupId') || 'Invalid or missing group ID.'
					)
					ctx.scene.state = ctx.scene.state || {}
					ctx.scene.state.silentLeave = true
					return ctx.scene.leave()
				} catch (error) {
					logger.error('Error sending message:', error)
					return ctx.scene.leave()
				}
			}

			// Check if we have user polls from session
			if (
				ctx.session.checkVoters.userPolls &&
				Array.isArray(ctx.session.checkVoters.userPolls)
			) {
				// Use user polls from session (from private chat)
				logger.debug('Using user polls from session', {
					pollsCount: ctx.session.checkVoters.userPolls.length,
					userId: ctx.from?.id,
					hasChat: !!chatId,
				})

				// Store polls in session for reference
				ctx.session.checkVoters.availablePolls =
					ctx.session.checkVoters.userPolls.filter(
						poll =>
							poll && typeof poll === 'object' && poll.id && poll.messageId
					)
			} else {
				// No user polls in session, query database
				logger.debug('Finding polls for chat', {
					chatId: chatId || 'undefined',
					sessionData: JSON.stringify(ctx.session.checkVoters),
				})

				// Build the query based on session data
				const query = {
					chatId: chatId,
					isClosed: false,
					$or: [
						{ fromCheckVoters: { $ne: true } }, // Exclude polls created from checkVoters
						{ isTracked: true }, // Include tracked polls
					],
				}

				logger.debug('Poll search query:', {
					chatId: chatId,
					specific_messageId:
						ctx.session.checkVoters.specificMessageId || 'none',
					query: JSON.stringify(query),
				})

				// If specific message ID was provided, filter by it
				if (ctx.session.checkVoters.specificMessageId) {
					query.messageId = ctx.session.checkVoters.specificMessageId
				}

				try {
					// Find recent polls in the specified chat (no limit here, we'll paginate later)
					const recentPolls = await Poll.find(query).sort({ createdAt: -1 })

					if (!recentPolls || recentPolls.length === 0) {
						try {
							// Extra debug info about why no polls were found
							logger.debug('No polls found with query:', {
								chatId: chatId,
								userId: ctx.from?.id,
								query: JSON.stringify(query),
							})

							await ctx.reply(t('voters.noActive'))
							// Set flag to prevent sending cancelledMessage
							ctx.scene.state = ctx.scene.state || {}
							ctx.scene.state.silentLeave = true
							return ctx.scene.leave()
						} catch (error) {
							logger.error('Error sending message:', error)
							return ctx.scene.leave()
						}
					}

					// Store polls in session for reference
					ctx.session.checkVoters.availablePolls = recentPolls.map(poll => ({
						id: poll._id.toString(),
						messageId: poll.messageId,
						title: poll.title || 'Untitled Poll',
						isTracked: !!poll.isTracked,
						chatId: poll.chatId,
					}))
				} catch (dbError) {
					logger.error('Database error fetching polls:', dbError)
					try {
						await ctx.reply(t('scenes.voters.errorFetchingPolls'))
						ctx.scene.state = ctx.scene.state || {}
						ctx.scene.state.silentLeave = true
						return ctx.scene.leave()
					} catch (replyError) {
						logger.error('Error replying with error message:', replyError)
						return ctx.scene.leave()
					}
				}
			}

			// Make sure availablePolls is always initialized as an array
			ctx.session.checkVoters.availablePolls =
				ctx.session.checkVoters.availablePolls || []

			// Log found polls
			logger.debug('Found polls for display', {
				count: ctx.session.checkVoters.availablePolls.length,
				pollIds: ctx.session.checkVoters.availablePolls.map(
					p => p.id || 'unknown'
				),
			})

			// Apply pagination to polls list
			const itemsPerPage = 5 // Show 5 polls per page
			const totalPolls = (ctx.session.checkVoters.availablePolls || []).length
			const currentPage = ctx.session.checkVoters.pollsPage || 0
			const totalPages = Math.ceil(totalPolls / itemsPerPage)
			const startIndex = currentPage * itemsPerPage
			const endIndex = Math.min(startIndex + itemsPerPage, totalPolls)

			// Get polls for the current page
			const currentPagePolls = (
				ctx.session.checkVoters.availablePolls || []
			).slice(startIndex, endIndex)

			// Create keyboard with available polls
			try {
				const pollButtons = currentPagePolls
					.map(poll => {
						try {
							// Create short title (max 30 chars)
							const shortTitle =
								(poll.title || 'Untitled Poll').length > 30
									? (poll.title || 'Untitled Poll').substring(0, 30) + '...'
									: poll.title || 'Untitled Poll'

							// Add [Tracked] indicator for tracked polls
							const prefix = poll.isTracked ? '🔍 ' : ''

							// For polls from different chats in private mode, add chat ID or group emoji
							let chatInfo = ''
							if (ctx.session.checkVoters.fromPrivate && poll.chatId) {
								// Try to format chat ID in a more readable way
								const shortChatId = String(poll.chatId).slice(-5) // Last 5 digits
								chatInfo = ` 👥${shortChatId}`
							}

							return [
								Markup.button.callback(
									`${prefix}${shortTitle}${chatInfo}`,
									`poll_${poll.messageId}_${
										poll.chatId || ctx.session.checkVoters.chatId
									}`
								),
							]
						} catch (pollError) {
							logger.warn('Error processing poll button:', pollError, { poll })
							// Return a simplified button for this poll
							return [
								Markup.button.callback(
									'Poll ' + (poll.messageId || 'unknown'),
									`poll_${poll.messageId || '0'}_${
										poll.chatId || ctx.session.checkVoters.chatId || '0'
									}`
								),
							]
						}
					})
					.filter(button => button && button.length > 0)

				// Add pagination buttons if there are multiple pages and more than 5 polls total
				if (totalPages > 1 && totalPolls > 5) {
					pollButtons.push([
						// Кнопка «Предыдущая страница» - отключена на первой странице
						Markup.button.callback(
							`◀️ ${t('scenes.common.prevButton') || 'Prev'}`,
							currentPage > 0 ? 'polls_page_prev' : 'polls_page_none',
							currentPage === 0
						),
						// Информация о текущей странице
						Markup.button.callback(
							`${currentPage + 1}/${totalPages}`,
							'polls_page_info'
						),
						// Кнопка «Следующая страница» - отключена на последней странице
						Markup.button.callback(
							`${t('scenes.common.nextButton') || 'Next'} ▶️`,
							currentPage < totalPages - 1
								? 'polls_page_next'
								: 'polls_page_none',
							currentPage >= totalPages - 1
						),
					])
				}

				// Add cancel button
				pollButtons.push([
					Markup.button.callback(
						t('scenes.voters.cancelButton'),
						'cancel_check'
					),
				])

				// If this is a callback update an existing message, otherwise send a new one
				if (ctx.callbackQuery) {
					try {
						await ctx.answerCbQuery()
					} catch (cbError) {
						logger.warn('Could not answer callback query:', cbError)
					}

					try {
						await ctx.editMessageText(
							t('scenes.voters.selectPoll'),
							Markup.inlineKeyboard(pollButtons)
						)
					} catch (editError) {
						logger.error('Error editing message:', editError)
						// Try with a simpler keyboard
						try {
							await ctx.editMessageText(
								t('scenes.voters.selectPoll'),
								Markup.inlineKeyboard([
									[Markup.button.callback('Cancel', 'cancel_check')],
								])
							)
						} catch (finalError) {
							logger.error('Final error editing message:', finalError)
						}
					}
				} else {
					// If this is being run from a private chat, add some context
					let messageText
					if (ctx.session.checkVoters.fromPrivate) {
						if (ctx.session.checkVoters.userPolls) {
							messageText = `${t('scenes.voters.yourPolls')}\n\n${t(
								'scenes.voters.selectPoll'
							)}`
						} else {
							messageText = `${t(
								'scenes.voters.pollsInGroup'
							)} ${chatId}:\n\n${t('scenes.voters.selectPoll')}`
						}
					} else {
						messageText = t('scenes.voters.selectPoll')
					}

					try {
						await ctx.reply(messageText, Markup.inlineKeyboard(pollButtons))
					} catch (error) {
						logger.error('Error sending poll list message:', error)
						try {
							await ctx.reply(
								t('scenes.voters.selectPoll'),
								Markup.inlineKeyboard([
									[Markup.button.callback('Cancel', 'cancel_check')],
								])
							)
						} catch (finalError) {
							logger.error('Final error sending message:', finalError)
							ctx.scene.state = ctx.scene.state || {}
							ctx.scene.state.silentLeave = true
							return ctx.scene.leave()
						}
					}
				}
			} catch (buttonError) {
				logger.error('Error creating poll buttons:', buttonError)
				try {
					// Send a simple message with just cancel button
					const message = ctx.callbackQuery
						? await ctx.editMessageText(
								t('scenes.voters.errorLoadingPolls'),
								Markup.inlineKeyboard([
									[Markup.button.callback('Cancel', 'cancel_check')],
								])
						  )
						: await ctx.reply(
								t('scenes.voters.errorLoadingPolls'),
								Markup.inlineKeyboard([
									[Markup.button.callback('Cancel', 'cancel_check')],
								])
						  )
				} catch (finalError) {
					logger.error('Failed to send final fallback message:', finalError)
				}
			}

			return
		} catch (error) {
			logger.error('Error getting recent polls:', error)
			try {
				await ctx.reply(t('scenes.voters.errorFetchingPolls'))
				// Set flag to prevent sending cancelledMessage
				ctx.scene.state = ctx.scene.state || {}
				ctx.scene.state.silentLeave = true
			} catch (replyError) {
				logger.error('Could not send error message:', replyError)
			}
			return ctx.scene.leave()
		}
	}

	// Handle poll selection
	const handlePollSelection = async (ctx, action) => {
		// Validate parameters
		if (!ctx) {
			logger.error('Missing context in handlePollSelection')
			return
		}

		if (!action) {
			logger.error('Missing action in handlePollSelection')
			return
		}

		const { t } = ctx.i18n || { t: key => key }

		logger.debug('Starting handlePollSelection', {
			action,
			hasContext: !!ctx,
			hasSession: !!ctx.session,
			stageBeforeSelection: ctx.session?.checkVoters?.stage || 'unknown',
		})

		// Ensure session data exists
		ctx.session = ctx.session || {}
		ctx.session.checkVoters = ctx.session.checkVoters || {
			chatId: ctx.chat?.id,
		}

		// Parse action data (now includes chat ID)
		const parts = action.replace('poll_', '').split('_')
		const parsedMessageId = parseInt(parts[0], 10)
		const parsedChatId =
			parts.length > 1 ? parseInt(parts[1], 10) : ctx.session.checkVoters.chatId

		logger.debug('Parsed poll data', {
			action: action,
			parts: parts,
			parsedMessageId: parsedMessageId,
			parsedChatId: parsedChatId,
			availablePollsCount: (ctx.session.checkVoters.availablePolls || [])
				.length,
		})

		// Find the selected poll from available polls for more data
		const selectedPoll = (ctx.session.checkVoters.availablePolls || []).find(
			p =>
				p.messageId === parsedMessageId &&
				(p.chatId === parsedChatId || !p.chatId)
		)

		// Store poll identifiers and stage in session
		ctx.session.checkVoters.messageId = parsedMessageId
		ctx.session.checkVoters.chatId = parsedChatId
		ctx.session.checkVoters.stage = 'select_option'

		// Store additional poll data if available
		if (selectedPoll) {
			ctx.session.checkVoters.selectedPollTitle = selectedPoll.title
			ctx.session.checkVoters.selectedPollId = selectedPoll.id
			logger.debug('Found selected poll', {
				title: selectedPoll.title,
				id: selectedPoll.id,
				messageId: selectedPoll.messageId,
				chatId: selectedPoll.chatId,
			})
		} else {
			logger.warn('Selected poll not found in availablePolls', {
				messageId: parsedMessageId,
				chatId: parsedChatId,
			})
		}

		logger.debug('Poll selected', {
			chatId: parsedChatId,
			messageId: parsedMessageId,
			sessionData: JSON.stringify(ctx.session.checkVoters),
		})

		try {
			logger.debug('Finding poll with messageId:', {
				messageId: parsedMessageId,
				chatId: parsedChatId,
			})

			// Get the selected poll
			// Search for poll using multiple criteria to improve reliability
			let poll = await Poll.findOne({
				chatId: parsedChatId,
				messageId: parsedMessageId,
			})

			// If poll not found, try alternative search methods
			if (!poll) {
				logger.debug(
					'Poll not found with primary search, trying alternate methods',
					{
						chatId: parsedChatId,
						messageId: parsedMessageId,
					}
				)

				// Try to find by message ID only (in case chat ID was recorded incorrectly)
				poll = await Poll.findOne({
					messageId: parsedMessageId,
				})
			}

			if (!poll) {
				logger.warn('Poll not found when selecting poll', {
					chatId: ctx.chat.id,
					messageId: parsedMessageId,
				})
				await ctx.answerCbQuery(t('voters.notFound', { messageId }))
				await ctx.editMessageText(t('voters.notFound', { messageId }))
				// Set flag to prevent sending cancelledMessage
				ctx.scene.state = ctx.scene.state || {}
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			}

			// Store poll data for future reference
			ctx.session.checkVoters.pollId = poll._id.toString()
			ctx.session.checkVoters.pollTitle = poll.title

			logger.debug('Found poll for options display', {
				pollId: poll._id,
				messageId: parsedMessageId,
				optionsCount: poll.options?.length || 0,
				sessionData: JSON.stringify(ctx.session.checkVoters),
			})

			// Create keyboard with poll options
			const optionButtons = []

			// If we're in private chat, add info about which group this poll is from
			if (ctx.session.checkVoters.fromPrivate) {
				optionButtons.push([
					Markup.button.callback(
						`${t('scenes.voters.pollInGroup')} ${poll.chatId}`,
						'poll_info'
					),
				])
			}

			// Ensure poll.options exists and is an array
			if (poll.options && Array.isArray(poll.options)) {
				poll.options.forEach((option, index) => {
					// Handle different option formats
					let optionText
					let voterCount = 0

					if (typeof option === 'object' && option !== null) {
						optionText = option.text
						voterCount = option.voterIds?.length || 0
					} else if (typeof option === 'string') {
						optionText = option
					} else {
						optionText = String(option || `Option ${index + 1}`)
					}

					// Add voter count for better UX, except for tracked polls with no votes yet
					const voteInfo = voterCount > 0 ? ` (${voterCount})` : ''

					optionButtons.push([
						Markup.button.callback(
							`${index + 1}. ${optionText}${voteInfo}`,
							`option_${index}`
						),
					])
				})
			} else {
				// Fallback if poll.options is not available
				logger.warn('Poll options not found or not an array', {
					hasOptions: !!poll.options,
					optionsType: typeof poll.options,
				})
				optionButtons.push([
					Markup.button.callback('1. Default Option', 'option_0'),
				])
			}

			// Add back and cancel buttons
			optionButtons.push([
				Markup.button.callback(
					'⬅️ ' + t('scenes.common.backButton'),
					'back_to_polls'
				),
				Markup.button.callback(t('scenes.voters.cancelButton'), 'cancel_check'),
			])

			// Add special note for tracked polls
			const trackedNote = poll.isTracked
				? t('scenes.voters.trackedPollNote')
				: ''
			const messageText = trackedNote
				? `${t('scenes.voters.selectOption')}\n\n${trackedNote}`
				: t('scenes.voters.selectOption')

			await ctx.answerCbQuery()
			await ctx.editMessageText(
				messageText,
				Markup.inlineKeyboard(optionButtons)
			)

			return
		} catch (error) {
			logger.error('Error fetching poll:', error)
			await ctx.answerCbQuery(t('scenes.voters.errorFetchingOptions'))
			await ctx.editMessageText(t('scenes.voters.errorFetchingOptions'))
			// Set flag to prevent sending cancelledMessage
			ctx.scene.state = ctx.scene.state || {}
			ctx.scene.state.silentLeave = true
			return ctx.scene.leave()
		}
	}

	// Функция проверки состояния сессии удалена, так как пагинация больше не используется

	// Handle option selection
	const handleOptionSelection = async (ctx, action) => {
		// Validate parameters
		if (!ctx) {
			logger.error('Missing context in handleOptionSelection')
			return
		}

		if (!action) {
			logger.error('Missing action in handleOptionSelection')
			return
		}

		const { t } = ctx.i18n || { t: key => key }

		// Ensure session data exists
		ctx.session = ctx.session || {}
		ctx.session.checkVoters = ctx.session.checkVoters || {
			chatId: ctx.chat?.id
		}
			
		// Log current session state
		logger.debug('Session before option selection', {
			sessionData: JSON.stringify(ctx.session.checkVoters),
			action: action,
		})

		// Update the stage in session
		ctx.session.checkVoters.stage = 'show_voters'

		// Ensure we have a messageId in the session
		if (!ctx.session.checkVoters.messageId) {
			logger.error('No messageId found in session for handleOptionSelection!')
			await ctx.answerCbQuery(t('scenes.voters.errorShowingVoters'))
			await ctx.editMessageText(t('scenes.voters.errorShowingVoters'))
			ctx.scene.state = ctx.scene.state || {}
			ctx.scene.state.silentLeave = true
			return ctx.scene.leave()
		}

		// No need to preserve data from scene state anymore
		// We're using ctx.session.checkVoters for all data storage

		logger.debug('Starting handleOptionSelection', {
			action,
			sessionData: JSON.stringify(ctx.session.checkVoters),
			messageId: ctx.session.checkVoters.messageId,
			chatId: ctx.session.checkVoters.chatId,
		})

		try {
			const optionIndex = parseInt(action.replace('option_', ''), 10)

			// Store the selected option index in session
			ctx.session.checkVoters.optionIndex = optionIndex

			// Get poll data from database using IDs stored in session
			const messageId = ctx.session.checkVoters.messageId
			const chatId = ctx.session.checkVoters.chatId
			const fromPrivate = ctx.session.checkVoters.fromPrivate || false

			// Log the messageId we're using
			logger.debug('Using messageId from session:', {
				messageId,
				chatId,
				fullSession: JSON.stringify(ctx.session.checkVoters),
			})

			if (!messageId || !chatId) {
				logger.error('Missing required poll identifiers', {
					messageId,
					chatId,
					sessionData: JSON.stringify(ctx.session.checkVoters),
				})
				await ctx.answerCbQuery(t('scenes.voters.errorShowingVoters'))
				await ctx.editMessageText(t('scenes.voters.errorShowingVoters'))
				ctx.scene.state = ctx.scene.state || {}
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			}

			logger.debug('Fetching poll for option selection', {
				chatId: chatId,
				messageId: messageId,
				optionIndex: optionIndex,
			})

			// Always get fresh poll data from database
			const poll = await Poll.findOne({
				chatId: chatId,
				messageId: messageId,
			})

			// Debug log poll structure
			logger.debug('Poll data retrieved for option selection', {
				pollFound: !!poll,
				hasOptions: !!poll?.options,
				optionsLength: poll?.options?.length,
				isTracked: poll?.isTracked,
				optionIndex: optionIndex,
				messageId: messageId,
			})

			// Check if poll exists
			if (!poll) {
				logger.error('Poll not found for option selection', {
					chatId: chatId,
					messageId: messageId,
				})
				await ctx.answerCbQuery(t('scenes.voters.errorShowingVoters'))
				await ctx.editMessageText(t('scenes.voters.errorShowingVoters'))
				ctx.scene.state = ctx.scene.state || {}
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			}

			// Ensure poll.options exists and is an array
			if (!poll.options || !Array.isArray(poll.options)) {
				logger.error('Poll options not found or not an array', {
					hasOptions: !!poll.options,
					optionsType: typeof poll.options,
				})
				await ctx.answerCbQuery(t('scenes.voters.errorShowingVoters'))
				await ctx.editMessageText(t('scenes.voters.errorShowingVoters'))
				ctx.scene.state = ctx.scene.state || {}
				ctx.scene.state.silentLeave = true
				return ctx.scene.leave()
			}

			// Check if the option index is valid
			if (
				optionIndex < 0 ||
				!poll.options ||
				optionIndex >= poll.options.length
			) {
				logger.warn('Invalid option index', {
					optionIndex,
					optionsLength: poll.options?.length || 0,
				})
				await ctx.answerCbQuery(
					t('voters.invalidOption', { count: poll.options?.length || 0 })
				)
				return
			}

			// Get the selected option (with additional safety checks)
			const option = poll.options ? poll.options[optionIndex] : null

			// Handle different option structures based on poll type
			let optionText
			let voterIds = []
			let existingVotes = 0

			if (!option) {
				// Handle missing option
				logger.warn('Option not found at index', {
					optionIndex,
					pollId: poll._id,
				})
				optionText = `Option ${optionIndex + 1}`
			} else if (typeof option === 'object' && option !== null) {
				// Regular poll format with option objects
				optionText = option.text || `Option ${optionIndex + 1}`
				voterIds = option.voterIds || []
				existingVotes = option.existingVotes || 0
			} else if (typeof option === 'string') {
				// Simple string option from tracked poll
				optionText = option
				// For tracked polls, we might not have voterIds array yet
				voterIds = []
			} else {
				// Fallback for unexpected option format
				logger.warn('Unexpected option format', {
					option,
					optionType: typeof option,
				})
				optionText = String(option || 'Unknown option')
			}

			logger.debug('Option selected', {
				optionIndex,
				optionText,
				optionType: typeof option,
				votersCount: voterIds.length,
				existingVotes: existingVotes,
			})
			await ctx.answerCbQuery()

			if (voterIds.length === 0 && existingVotes === 0) {
				let noVotersMessage = t('voters.noVoters', { option: optionText })

				// Special message for tracked polls explaining that only new votes will be tracked
				if (poll.isTracked) {
					if (poll.total_voter_count && poll.total_voter_count > 0) {
						// If poll has votes but we can't tell which option they're for
						noVotersMessage =
							t('voters.cannotDetermineVotes', {
								option: optionText,
								count: poll.total_voter_count,
							}) ||
							`Для варианта "${optionText}" невозможно определить проголосовавших пользователей из ${poll.total_voter_count} голосов в анонимном опросе.`
					} else {
						noVotersMessage +=
							'\n\n' + t('scenes.voters.trackedPollNoVotersYet')
					}
				}

				await ctx.editMessageText(
					noVotersMessage,
					Markup.inlineKeyboard([
						[
							Markup.button.callback(
								'⬅️ ' + t('scenes.common.backButton'),
								'back_to_polls'
							),
						],
						[
							Markup.button.callback(
								t('scenes.voters.finishButton'),
								'finish_check'
							),
						],
					])
				)

				logger.debug('No voters found for option', {
					pollId: poll._id,
					optionIndex,
					optionText,
					messageId: messageId,
				})

				return
			}

			// Process voters and create lists (with safety check)
			const { votersList, mentionsList, anonymousCount } = await processVoters(
				ctx,
				poll,
				voterIds || []
			)

			// Calculate the total number of anonymous votes (from before tracking and anonymous voters)
			const totalAnonymousVotes = (existingVotes || 0) + (anonymousCount || 0)

			// Log detailed information about voters for debugging
			logger.debug('Voter information processed', {
				pollId: poll._id,
				optionIndex,
				namedVoters: votersList.length,
				anonymousVoters: anonymousCount,
				existingVotes: existingVotes || 0,
				totalVoterIds: voterIds ? voterIds.length : 0,
				negativeIds: voterIds ? voterIds.filter(id => id < 0).length : 0,
			})

			// log voter counts
			logger.debug('Processed voters', {
				namedVoters: votersList.length,
				anonymousVoters: anonymousCount,
				existingVotes: existingVotes || 0,
				totalAnonymousVotes,
			})

			// Calculate total existing votes (with safety checks)
			const totalExistingVotes =
				poll && poll.options && Array.isArray(poll.options)
					? poll.options.reduce(
							(sum, opt) => sum + (opt?.existingVotes || 0),
							0
					  )
					: 0

			// Join user names with commas for display (with safety checks)
			const formattedVotersList =
				Array.isArray(votersList) && votersList.length > 0
					? votersList.join(', ')
					: ''

			// Create a string of mentions for copy-paste
			const formattedMentionsList =
				Array.isArray(mentionsList) && mentionsList.length > 0
					? mentionsList.join(' ')
					: ''

			// Handle existing votes from before tracking and anonymous votes
			const hasAnonymousVotes = totalAnonymousVotes > 0

			// Different messages for different types of anonymous votes
			let anonymousVotesText = ''
			if (hasAnonymousVotes) {
				logger.debug('Anonymous votes detected', {
					pollId: poll._id,
					total: totalAnonymousVotes,
					existingVotes: existingVotes || 0,
					anonymousCount,
				})
				if (poll.isTracked && existingVotes > 0 && anonymousCount > 0) {
					// Both pre-tracking votes and anonymous votes during tracking
					anonymousVotesText =
						t('voters.mixedAnonymousVotes', {
							existing: existingVotes,
							anonymous: anonymousCount,
						}) ||
						`Including ${existingVotes} votes from before tracking and ${anonymousCount} anonymous votes`

					// Add a note about Telegram API limitations
					anonymousVotesText += `\n\n${
						t('voters.trackingLimitation') ||
						'Note: Due to Telegram API limitations, votes made before tracking cannot be identified. Track polls before voting starts for best results.'
					}`
				} else if (poll.isTracked && existingVotes > 0) {
					// Only pre-tracking votes
					anonymousVotesText =
						t('voters.existingVotes', { count: existingVotes }) ||
						`Plus ${existingVotes} anonymous votes from before tracking`

					// Add a note about Telegram API limitations
					anonymousVotesText += `\n\n${
						t('voters.trackingLimitation') ||
						'Note: Due to Telegram API limitations, votes made before tracking cannot be identified. Track polls before voting starts for best results.'
					}`
				} else if (anonymousCount > 0) {
					// Only anonymous votes during tracking
					anonymousVotesText =
						t('voters.anonymousVotes', { count: anonymousCount }) ||
						`Plus ${anonymousCount} anonymous votes`
				} else {
					// Generic fallback
					anonymousVotesText =
						t('voters.totalAnonymousVotes', { count: totalAnonymousVotes }) ||
						`Plus ${totalAnonymousVotes} anonymous votes`
				}
			}

			// Save the poll ID and option info in session
			ctx.session.checkVoters.pollId = poll._id.toString()
			ctx.session.checkVoters.selectedVoters = votersList
			ctx.session.checkVoters.mentionsList = mentionsList
			ctx.session.checkVoters.selectedOption = optionText
			ctx.session.checkVoters.optionIndex = optionIndex

			// Пагинация больше не используется

			logger.debug('Saved voter data to session', {
				pollId: poll._id.toString(),
				selectedOption: optionText,
				optionIndex: optionIndex,
				votersCount: votersList.length,
				sessionData: JSON.stringify(ctx.session.checkVoters),
			})

			// Format a single message with all voter information
			let message = []

			// If this is from private chat, add header with poll title and chat info
			if (fromPrivate && ctx.session?.checkVoters?.selectedPollTitle) {
				message.push(`📊 ${ctx.session.checkVoters.selectedPollTitle}`)
				message.push(`👥 ${t('scenes.voters.pollInGroup')} ${chatId}`)

				// Add info about tracking status if it's a tracked poll
				if (poll && poll.isTracked && poll.trackedAt) {
					try {
						const trackingDate = new Date(poll.trackedAt).toLocaleString()
						message.push(
							`🔍 ${
								t('voters.trackedSince', { date: trackingDate }) ||
								`Tracking since: ${trackingDate}`
							}\n`
						)
					} catch (error) {
						logger.warn('Error formatting tracking date:', error)
						message.push(`🔍 ${t('voters.tracked') || 'Tracking enabled'}\n`)
					}
				} else {
					message.push('')
				}
			}

			// Calculate total voters count including existing votes and anonymous votes
			// Only count named voters, not anonymous ones
			const namedVotersCount = votersList.length
			const hasNamedVoters = namedVotersCount > 0

			// Add voter information (showing only named voters count)
			message.push(
				`${t('voters.optionVoters', {
					option: optionText,
					count: namedVotersCount,
				})}`
			)

			// Показываем информацию о проголосовавших НЕ здесь, у нас уже есть заголовок
			// Вместо этого, пагинация и список применяются ниже после проверки на длину сообщения

			// Join all parts with new lines
			const messageText = message.join('\n')

			// Define itemsPerPage before using it
			const itemsPerPage = 5

			// Create action buttons
			// Не используем пагинацию, так как не показываем список
			
			const actionButtons = [
				[
					Markup.button.callback(
						t('scenes.voters.createPollButton'),
						'create_poll_with_users'
					),
				],
				[
					Markup.button.callback(
						'⬅️ ' + t('scenes.common.backButton'),
						'back_to_polls'
					),
				],
				[
					Markup.button.callback(
						t('scenes.voters.finishButton'),
						'finish_check'
					),
				],
			]

			try {
				// Создаем сообщение без пагинации
				let fullMessage = messageText

				// Не отображаем список проголосовавших и пагинацию
				
				// Check if the message might be too long for Telegram
				if (fullMessage.length > 4000) {
					// If too long, show a simplified message - only count named voters
					const namedVotersCount = voterIds.length
					let simplifiedMessage = `${t('voters.optionVoters', {
						option: optionText,
						count: namedVotersCount,
					})}\n`

					// Не отображаем список проголосовавших и пагинацию в упрощенном режиме

					const createPollPrompt = t('scenes.voters.createPollPrompt')
					if (createPollPrompt) {
						simplifiedMessage += `\n\n${createPollPrompt}`
					}

					await ctx.editMessageText(
						simplifiedMessage,
						Markup.inlineKeyboard(actionButtons)
					)
				} else {
					// Show the full message
					await ctx.editMessageText(
						fullMessage,
						Markup.inlineKeyboard(actionButtons)
					)
				}
			} catch (error) {
				logger.error('Error updating message with voter info:', error)

				// Try with simpler message as fallback
				let fallbackMessage = ''

				// Add poll info for private chat
				if (fromPrivate && ctx.session.checkVoters.selectedPollTitle) {
					fallbackMessage += `📊 ${ctx.session.checkVoters.selectedPollTitle}\n`
					fallbackMessage += `👥 ${t(
						'scenes.voters.pollInGroup'
					)} ${chatId}\n\n`
				}

				// Calculate named voters count - excluding anonymous
				const namedVotersCount = voterIds.length

				fallbackMessage += `${t('voters.optionVoters', {
					option: optionText,
					count: namedVotersCount,
				})}\n`

				// Не отображаем список проголосовавших и пагинацию в fallback-сообщении

				// No info about anonymous votes needed

				// Add tracking info if available
				if (poll.isTracked && poll.trackedAt) {
					const trackingDate = new Date(poll.trackedAt).toLocaleString()
					fallbackMessage += `\n\n🔍 ${
						t('voters.trackedSince', { date: trackingDate }) ||
						`Tracking since: ${trackingDate}`
					}\n`
				}

				fallbackMessage += `\n${t('scenes.voters.errorFormattingVoters')}\n`

				const createPollPrompt = t('scenes.voters.createPollPrompt')
				if (createPollPrompt) {
					fallbackMessage += `\n${createPollPrompt}`
				}

				await ctx.editMessageText(
					fallbackMessage,
					Markup.inlineKeyboard(actionButtons)
				)
			}

			return
		} catch (error) {
			logger.error('Error showing voters:', error, {
				errorName: error.name,
				errorMessage: error.message,
				errorStack: error.stack,
				actionData: action,
				sessionData: JSON.stringify(ctx.session.checkVoters || {}),
			})

			try {
				try {
					const { t } = ctx.i18n || { t: key => key }
					await ctx.answerCbQuery(t('scenes.voters.errorShowingVoters'))
					await ctx.editMessageText(
						t('scenes.voters.errorShowingVoters'),
						Markup.inlineKeyboard([
							[
								Markup.button.callback(
									'⬅️ ' + t('scenes.common.backButton'),
									'back_to_polls'
								),
							],
							[
								Markup.button.callback(
									t('scenes.voters.finishButton'),
									'finish_check'
								),
							],
						])
					)
				} catch (error) {
					logger.error('Error updating error message:', error)
				}

				// Set flag to prevent sending cancelledMessage
				ctx.scene.state = ctx.scene.state || {}
				ctx.scene.state.silentLeave = true
			} catch (updateError) {
				logger.error('Error updating message:', updateError)
			}
			return
		}
	}

	// Process the voters and create formatted lists
	const processVoters = async (ctx, poll, voterIds) => {
		// Check for required parameters
		if (!ctx) {
			logger.error('Missing context in processVoters')
			return { votersList: [], mentionsList: [], anonymousCount: 0 }
		}

		if (!poll) {
			logger.error('Missing poll in processVoters')
			return { votersList: [], mentionsList: [], anonymousCount: 0 }
		}

		const votersList = []
		const mentionsList = []

		// Count anonymous voters (with negative IDs)
		let anonymousCount = 0

		// If no voters yet, return empty lists
		if (!voterIds || voterIds.length === 0) {
			return { votersList, mentionsList, anonymousCount }
		}

		// Get the chat ID from session
		const chatId = ctx.session.checkVoters?.chatId || ctx.chat?.id
		if (!chatId) {
			logger.error('No chatId available for processVoters')
			return { votersList, mentionsList, anonymousCount }
		}

		// Filter out and count anonymous voters (with negative IDs)
		const namedVoterIds = []

		// Process each voter - count anonymous votes (negative IDs are placeholders for anonymous votes)
		for (const voterId of voterIds) {
			if (voterId < 0) {
				anonymousCount++
			} else {
				namedVoterIds.push(voterId)
			}
		}

		// Process each named voter
		for (const voterId of namedVoterIds) {
			try {
				if (!poll.mentions || !Array.isArray(poll.mentions)) {
					logger.warn('Missing mentions array in poll')
					poll.mentions = []
				}

				// Find the mentioned user by userId or if userId is negative (temporary), by username
				let mentionedUser = poll.mentions.find(m => m && m.userId === voterId)

				// For negative userIds (temporary ones), we need additional handling
				if (!mentionedUser && voterId < 0) {
					try {
						// Try to match with real users who may have been resolved
						const chatMember = await ctx.telegram
							.getChatMember(chatId, Math.abs(voterId))
							.catch(() => null)

						if (chatMember && chatMember.user) {
							mentionedUser = poll.mentions.find(
								m =>
									m &&
									m.username &&
									chatMember.user.username &&
									m.username.toLowerCase() ===
										chatMember.user.username.toLowerCase()
							)
						}
					} catch (error) {
						logger.warn(
							`Error fetching chat member for user ID ${Math.abs(voterId)}:`,
							error
						)
					}
				}

				if (mentionedUser && mentionedUser.username) {
					// For users with username
					const username = mentionedUser.username
					votersList.push(`@${username}`)
					mentionsList.push(`@${username}`)
				} else if (mentionedUser && mentionedUser.userId) {
					// For mentioned users without username but with userId
					try {
						const chatMember = await ctx.telegram.getChatMember(
							chatId,
							mentionedUser.userId
						)
						if (chatMember && chatMember.user) {
							const user = chatMember.user
							if (user.username) {
								votersList.push(`@${user.username}`)
								mentionsList.push(`@${user.username}`)
							} else {
								const name = [user.first_name, user.last_name]
									.filter(Boolean)
									.join(' ')
								votersList.push(`${name || 'User'}`)
								mentionsList.push(`@${user.id}`)
							}
						} else {
							votersList.push(`User ${mentionedUser.userId}`)
							mentionsList.push(`@${mentionedUser.userId}`)
						}
					} catch (error) {
						logger.warn(
							`Could not get chat member info for mentioned user ${mentionedUser.userId}:`,
							error
						)
						votersList.push(`User ${mentionedUser.userId}`)
						mentionsList.push(`@${mentionedUser.userId}`)
					}
				} else {
					// Try to get user info from the chat
					try {
						const chatMember = await ctx.telegram.getChatMember(chatId, voterId)
						if (chatMember && chatMember.user) {
							const user = chatMember.user
							if (user.username) {
								votersList.push(`@${user.username}`)
								mentionsList.push(`@${user.username}`)
							} else {
								const name = [user.first_name, user.last_name]
									.filter(Boolean)
									.join(' ')
								votersList.push(`${name || 'User'}`)
								mentionsList.push(`@${user.id}`)
							}
						} else {
							// Fallback if user info not available
							votersList.push(`User ${voterId}`)
							mentionsList.push(`@${voterId}`)
						}
					} catch (error) {
						logger.warn(
							`Could not get chat member info for user ${voterId}:`,
							error
						)
						votersList.push(`User ${voterId}`)
						mentionsList.push(`@${voterId}`)
					}
				}
			} catch (err) {
				logger.error(`Error processing voter ${voterId}:`, err)
				votersList.push(`User ${voterId}`)
				mentionsList.push(`@${voterId}`)
			}
		}

		return {
			votersList: votersList || [],
			mentionsList: mentionsList || [],
			anonymousCount: anonymousCount || 0,
		}
	}

	// Handle creating a poll with selected users
	// Create and send poll with selected users
	const handleCreatePoll = async ctx => {
		// Validate context
		if (!ctx) {
			logger.error('Missing context in handleCreatePoll')
			return
		}

		const { t } = ctx.i18n || { t: key => key }

		try {
			await ctx.answerCbQuery()
		} catch (error) {
			logger.warn('Could not answer callback query in handleCreatePoll:', error)
		}

		// Ensure session data exists
		ctx.session = ctx.session || {}
		ctx.session.checkVoters = ctx.session.checkVoters || {
			chatId: ctx.chat?.id,
		}

		// Update stage
		ctx.session.checkVoters.stage = 'create_poll'

		// Get poll data from session
		const messageId = ctx.session.checkVoters.messageId
		const chatId = ctx.session.checkVoters.chatId
		const optionIndex = ctx.session.checkVoters.optionIndex
		const fromPrivate = ctx.session.checkVoters.fromPrivate || false

		logger.debug('Creating poll with user votes', {
			chatId,
			messageId,
			optionIndex,
			fromPrivate,
			hasSelectedVoters: !!ctx.session.checkVoters.selectedVoters,
			sessionData: JSON.stringify(ctx.session.checkVoters),
		})

		// Get the saved voters and option
		const { selectedVoters, mentionsList, selectedOption } =
			ctx.session.checkVoters

		if (!selectedVoters || !mentionsList || !selectedOption) {
			logger.error('Missing required data for poll creation', {
				hasSelectedVoters: !!selectedVoters,
				hasMentionsList: !!mentionsList,
				hasSelectedOption: !!selectedOption,
				sessionData: JSON.stringify(ctx.session.checkVoters),
			})
			await ctx.editMessageText(
				t('scenes.voters.errorCreatingPoll'),
				Markup.inlineKeyboard([
					[
						Markup.button.callback(
							'⬅️ ' + t('scenes.common.backButton'),
							'back_to_polls'
						),
					],
				])
			)
			return
		}

		// Create a suggested title based on selected option
		const suggestedTitle = `${t('scenes.voters.followUpTitle', {
			option: selectedOption,
		})}`

		// Update message to show we're creating a poll
		let creatingPollMessageId = null
		try {
			// Удалим предыдущее сообщение перед созданием нового
			const message = await ctx.editMessageText(
				`${t('scenes.voters.startingPollCreation')}`,
				Markup.inlineKeyboard([])
			)
			// Убедимся, что мы получили действительный ID сообщения
			if (message && message.message_id) {
				creatingPollMessageId = message.message_id
			} else if (ctx.callbackQuery && ctx.callbackQuery.message) {
				creatingPollMessageId = ctx.callbackQuery.message.message_id
			}

			// Store the message ID in the session for later deletion
			ctx.session.checkVoters.creatingPollMessageId = creatingPollMessageId

			logger.debug('Created poll creation message:', {
				messageId: creatingPollMessageId,
				chatId: ctx.chat?.id,
			})
		} catch (error) {
			logger.warn(
				'Could not update message when starting poll creation:',
				error
			)
			// Если не удалось обновить сообщение, используем ID текущего сообщения
			if (ctx.callbackQuery && ctx.callbackQuery.message) {
				creatingPollMessageId = ctx.callbackQuery.message.message_id
				// Store the message ID in the session for later deletion
				ctx.session.checkVoters.creatingPollMessageId = creatingPollMessageId
			}
		}

		// Set flag to prevent sending cancelledMessage
		ctx.scene.state = ctx.scene.state || {}
		ctx.scene.state.silentLeave = true

		// Exit this scene
		await ctx.scene.leave()

		// Pass data to create poll scene with compact mode flag
		const checkData = {
			importedMentions: mentionsList,
			selectedOption: selectedOption,
			selectedVoters: selectedVoters,
			compactMode: true, // Signal that we want compact mode
			suggestedTitle: suggestedTitle, // Pass the suggested title
			interfaceMessageId: ctx.callbackQuery.message.message_id, // Store interface message ID for cleanup
			creatingPollMessageId: creatingPollMessageId, // Добавляем ID сообщения "Создание опроса..."
			messageId: ctx.session.checkVoters.messageId, // Include the poll message ID
			targetChatId: chatId, // Include target chat ID for creating in the original group
			fromPrivate: fromPrivate, // Flag indicating if we're in a private chat
			fromCheckVoters: true, // Flag indicating this poll is created from checkVoters
			originalPollTitle:
				ctx.session.checkVoters.selectedPollTitle ||
				ctx.session.checkVoters.pollTitle ||
				'Untitled Poll', // Original poll title
		}

		// Enter compact poll creation scene with data
		return ctx.scene.enter('compact-create-poll', { checkData })
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

	// Create scene with multiple steps to maintain state between actions
	const scene = new Scenes.WizardScene(
		'check-voters',
		handleCallback, // Step 0: Select poll
		handleCallback, // Step 1: Select option
		handleCallback, // Step 2: Show voters
		handleCallback // Step 3: Create poll
	)

	// Add middleware to log step transitions and ensure data consistency
	// Add middleware to log transitions
	scene.use((ctx, next) => {
		logger.debug('Scene transition', {
			sceneName: 'check-voters',
			stage: ctx.session.checkVoters?.stage || 'unknown',
			messageId: ctx.session.checkVoters?.messageId || null,
			chatId: ctx.chat?.id || ctx.session.checkVoters?.chatId || null,
			fromPrivate: ctx.session.checkVoters?.fromPrivate || false,
		})
		return next()
	})

	// Add leave middleware to handle silent leave
	scene.leave((ctx, next) => {
		// Log scene state and session for debugging
		logger.debug('Leaving check-voters scene', {
			hasSceneState: !!ctx.scene.state,
			silentLeave: ctx.scene.state?.silentLeave,
			sceneState: JSON.stringify(ctx.scene.state || {}),
			sessionData: JSON.stringify(ctx.session?.checkVoters || {}),
			stage: ctx.session?.checkVoters?.stage || 'unknown',
		})

		// Delete the creating poll message if it exists
		if (ctx.session?.checkVoters?.creatingPollMessageId) {
			safeDeleteMessage(
				ctx,
				ctx.session.checkVoters.creatingPollMessageId,
				'creating poll message on leave'
			).catch(error => {
				logger.warn('Could not delete creating poll message on leave:', error)
			})
		}

		if (ctx.scene.state?.silentLeave) {
			// Skip sending leave message
			return next()
		}

		// Default leave behavior would continue here
		try {
			const { t } = ctx.i18n || { t: key => key }
			ctx.reply(t('scenes.voters.cancelledMessage')).catch(error => {
				logger.warn('Could not send cancelled message:', error)
			})
		} catch (error) {
			logger.error('Error in scene.leave handler:', error)
		}
		return next()
	})

	return scene
}

module.exports = checkVotersScene
