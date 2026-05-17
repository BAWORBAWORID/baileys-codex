import { readFileSync, writeFileSync, existsSync } from 'fs'
import { proto } from '../../WAProto/index.js'
import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js'
import { LabelAssociationType } from '../Types/LabelAssociation.js'
import type { LabelAssociation } from '../Types/LabelAssociation.js'
import { toNumber, md5, updateMessageWithReceipt, updateMessageWithReaction } from '../Utils/index.js'
import type { ILogger } from '../Utils/logger.js'
import { jidDecode, jidNormalizedUser } from '../WABinary/index.js'
import makeOrderedDictionary from './make-ordered-dictionary.js'
import { ObjectRepository } from './object-repository.js'
import KeyedDB from '@adiwajshing/keyed-db'
import type { BaileysEventEmitter } from '../Types/Events.js'
import type { WAMessage, WAMessageKey } from '../Types/Message.js'
import type { GroupMetadata } from '../Types/GroupMetadata.js'

type ChatKeyType = {
	key: (c: proto.IConversation & { pinned?: boolean }) => string
	compare: (k1: string, k2: string) => number
}

type LabelAssociationKeyType = {
	key: (la: LabelAssociation) => string
	compare: (k1: string, k2: string) => number
}

interface StoreConfig {
	socket?: any
	chatKey?: ChatKeyType
	labelAssociationKey?: LabelAssociationKeyType
	logger?: ILogger
}

type OrderedDict = ReturnType<typeof makeOrderedDictionary<WAMessage>>

export const waChatKey = (pin: boolean) => ({
		key: (c: any) =>
			(pin ? (c.pinned ? '1' : '0') : '') +
			(c.archived ? '0' : '1') +
			(c.conversationTimestamp ? (c.conversationTimestamp as number).toString(16).padStart(8, '0') : '') +
			c.id!,
		compare: (k1: string, k2: string) => k2.localeCompare(k1)
	})

export const waMessageID = (m: { key: WAMessageKey }) => m.key.id || ''

export const waLabelAssociationKey: LabelAssociationKeyType = {
	key: (la: LabelAssociation) =>
		la.type === LabelAssociationType.Chat
			? la.chatId + la.labelId
			: la.chatId + la.messageId + la.labelId,
	compare: (k1: string, k2: string) => k2.localeCompare(k1)
}

const makeMessagesDictionary = () => makeOrderedDictionary<WAMessage>(waMessageID)

export default (config: StoreConfig) => {
	const socket = config.socket
	const chatKey = config.chatKey || waChatKey(true)
	const labelAssociationKey = config.labelAssociationKey || waLabelAssociationKey
	const logger = config.logger || DEFAULT_CONNECTION_CONFIG.logger.child({ stream: 'in-mem-store' })

	const chats = new (KeyedDB as any)(chatKey, (c: any) => c.id!)
	const messages: Record<string, OrderedDict | undefined> = {}
	const contacts: Record<string, any> = {}
	const groupMetadata: Record<string, GroupMetadata | undefined> = {}
	const presences: Record<string, Record<string, any> | undefined> = {}
	const state: { connection: string } = { connection: 'close' }
	const labels = new ObjectRepository<any>()
	const labelAssociations = new (KeyedDB as any)(labelAssociationKey as any)

	const assertMessageList = (jid: string): OrderedDict => {
		if (!messages[jid]) {
			messages[jid] = makeMessagesDictionary()
		}
		const list = messages[jid]!
		return list
	}

	const contactsUpsert = (newContacts: any[]) => {
		const oldContacts = new Set(Object.keys(contacts))
		for (const contact of newContacts) {
			oldContacts.delete(contact.id)
			contacts[contact.id] = Object.assign(contacts[contact.id] || {}, contact)
		}
		return oldContacts
	}

	const labelsUpsert = (newLabels: any[]) => {
		for (const label of newLabels) {
			labels.upsertById(label.id, label)
		}
	}

	const getValidContacts = () => {
		for (const contact of Object.keys(contacts)) {
			if (contact.indexOf('@') < 0) {
				delete contacts[contact]
			}
		}
		return Object.keys(contacts)
	}

	const bind = (ev: BaileysEventEmitter) => {
		ev.on('connection.update', (update: any) => {
			Object.assign(state, update)
		})

		ev.on('messaging-history.set', ({ chats: newChats, contacts: newContacts, messages: newMessages, isLatest }: any) => {
			if (isLatest) {
				chats.clear()
				for (const id in messages) {
					delete messages[id]
				}
			}
			const chatsAdded = (chats as any).insertIfAbsent(...newChats).length
			logger.debug({ chatsAdded }, 'synced chats')
			const oldContacts = contactsUpsert(newContacts)
			if (isLatest) {
				for (const jid of oldContacts) {
					delete contacts[jid]
				}
			}
			logger.debug({ deletedContacts: isLatest ? oldContacts.size : 0, newContacts }, 'synced contacts')
			for (const msg of newMessages) {
				const jid = msg.key.remoteJid as string
				const list = assertMessageList(jid)
				list.upsert(msg, 'prepend')
			}
			logger.debug({ messages: newMessages.length }, 'synced messages')
		})

		ev.on('contacts.upsert', (contacts: any[]) => {
			contactsUpsert(contacts)
		})

		ev.on('contacts.update', async (updates: any[]) => {
			for (const update of updates) {
				let contact: any
				if (contacts[update.id]) {
					contact = contacts[update.id]
				} else {
					const validContacts = getValidContacts()
					const contactHashes = validContacts.map((contactId: string) => {
						const { user } = jidDecode(contactId)!
						return [contactId, (md5 as any)(Buffer.from(user + 'WA_ADD_NOTIF', 'utf8')).toString('base64').slice(0, 3)] as [string, string]
						})
						contact = contacts[contactHashes.find(([, b]: [string, string]) => b === update.id)?.[0] || '']
					}
					if (contact) {
					if (update.imgUrl === 'changed') {
						contact.imgUrl = socket ? await socket.profilePictureUrl(contact.id) : undefined
					} else if (update.imgUrl === 'removed') {
						delete contact.imgUrl
					}
					Object.assign(contacts[contact.id], contact)
				} else {
					logger.debug({ update }, 'got update for non-existant contact')
				}
			}
		})

		ev.on('chats.upsert', (newChats: any[]) => {
			(chats as any).upsert(...newChats)
		})

		ev.on('chats.update', (updates: any[]) => {
			for (let update of updates) {
				const result = (chats as any).update(update.id, (chat: any) => {
					if (update.unreadCount > 0) {
						update = { ...update }
						update.unreadCount = (chat.unreadCount || 0) + update.unreadCount
					}
					Object.assign(chat, update)
				})
				if (!result) {
					logger.debug({ update }, 'got update for non-existant chat')
				}
			}
		})

		ev.on('labels.edit', (label: any) => {
			if (label.deleted) {
				return labels.deleteById(label.id)
			}

			if (labels.count() < 20) {
				return labels.upsertById(label.id, label)
			}
			logger.error('Labels count exceed')
		})

		ev.on('labels.association', ({ type, association }: { type: string; association: LabelAssociation }) => {
			switch (type) {
				case 'add':
					labelAssociations.upsert(association)
					break
				case 'remove':
					labelAssociations.delete(association)
					break
				default:
					console.error(`unknown operation type [${type}]`)
			}
		})

		ev.on('presence.update', ({ id, presences: update }: { id: string; presences: Record<string, any> }) => {
			presences[id] = presences[id] || {}
			Object.assign(presences[id], update)
		})

		ev.on('chats.delete', (deletions: string[]) => {
			for (const item of deletions) {
				if ((chats as any).get(item)) {
					(chats as any).deleteById(item)
				}
			}
		})

		ev.on('messages.upsert', ({ messages: newMessages, type }: { messages: WAMessage[]; type: string }) => {
			switch (type) {
				case 'append':
				case 'notify':
					for (const msg of newMessages) {
						const jid = jidNormalizedUser(msg.key.remoteJid || undefined)
						const list = assertMessageList(jid)
						list.upsert(msg, 'append')
			if (type === 'notify' && !(chats as any).get(jid)) {
							;(ev as any).emit('chats.upsert', [
								{
									id: jid,
									conversationTimestamp: toNumber(msg.messageTimestamp as any),
									unreadCount: 1
								}
							])
						}
					}
					break
			}
		})

		ev.on('messages.update', (updates: { update: any; key: WAMessageKey }[]) => {
			for (const { update, key } of updates) {
				const list = assertMessageList(jidNormalizedUser(key.remoteJid || undefined))
				if (update?.status) {
					const existingMsg = list.get(key.id!)
					const listStatus = (existingMsg as any)?.status
					if (listStatus && update.status <= listStatus) {
						logger.debug({ update, storedStatus: listStatus }, 'status stored newer then update')
						delete update.status
						logger.debug({ update }, 'new update object')
					}
				}
				const result = list.updateAssign(key.id!, update)
				if (!result) {
					logger.debug({ update }, 'got update for non-existent message')
				}
			}
		})

		ev.on('messages.delete', (item: any) => {
			if ('all' in item) {
				const list = messages[item.jid]
				list?.clear()
			} else {
				const jid = item.keys[0]?.remoteJid
				const list = messages[jid]
				if (list) {
					const idSet = new Set(item.keys.map((k: WAMessageKey) => k.id))
					list.filter(m => !idSet.has(m.key.id))
				}
			}
		})

		ev.on('groups.update', (updates: any[]) => {
			for (const update of updates) {
				const id = update.id
				if (groupMetadata[id]) {
					Object.assign(groupMetadata[id], update)
				} else {
					logger.debug({ update }, 'got update for non-existant group metadata')
				}
			}
		})

		ev.on('group-participants.update', ({ id, participants, action }: any) => {
			const metadata = groupMetadata[id]
			if (metadata) {
				switch (action) {
					case 'add':
						metadata.participants.push(...participants.map((id: string) => ({ id, isAdmin: false, isSuperAdmin: false })))
						break
					case 'demote':
					case 'promote':
						for (const participant of metadata.participants) {
							if (participants.includes(participant.id)) {
								participant.isAdmin = action === 'promote'
							}
						}
						break
					case 'remove':
						metadata.participants = metadata.participants.filter(p => !participants.includes(p.id))
						break
				}
			}
		})

		ev.on('message-receipt.update', (updates: any[]) => {
			for (const { key, receipt } of updates) {
				const obj = messages[key.remoteJid!]
				const msg = obj?.get(key.id!)
				if (msg) {
					updateMessageWithReceipt(msg as any, receipt)
				}
			}
		})

		ev.on('messages.reaction', (reactions: any[]) => {
			for (const { key, reaction } of reactions) {
				const obj = messages[key.remoteJid!]
				const msg = obj?.get(key.id!)
				if (msg) {
					updateMessageWithReaction(msg as any, reaction)
				}
			}
		})
	}

	const toJSON = () => ({
		chats,
		contacts,
		messages,
		labels,
		labelAssociations
	})

	const fromJSON = (json: any) => {
		(chats as any).upsert(...json.chats)
		(labelAssociations as any).upsert(...(json.labelAssociations || []))
		contactsUpsert(Object.values(json.contacts))
		labelsUpsert(Object.values(json.labels || {}))
		for (const jid in json.messages) {
			const list = assertMessageList(jid)
			for (const msg of json.messages[jid]) {
				list.upsert(proto.WebMessageInfo.fromObject(msg) as any, 'append')
			}
		}
	}

	return {
		chats,
		contacts,
		messages,
		groupMetadata,
		state,
		presences,
		labels,
		labelAssociations,
		bind,

		loadMessages: async (jid: string, count: number, cursor?: { before?: WAMessageKey; after?: WAMessageKey }) => {
			const list = assertMessageList(jid)
			const mode = !cursor || 'before' in cursor ? 'before' : 'after'
			const cursorKey = cursor ? ('before' in cursor ? cursor.before : cursor.after) : undefined
			const cursorValue = cursorKey ? list.get(cursorKey.id!) : undefined
			let resultMessages: WAMessage[]
			if (mode === 'before' && (!cursorKey || cursorValue)) {
				if (cursorValue) {
					const msgIdx = list.array.findIndex(m => m.key.id === cursorKey?.id)
					resultMessages = list.array.slice(0, msgIdx) as WAMessage[]
				} else {
					resultMessages = list.array as WAMessage[]
				}
				const diff = count - resultMessages.length
				if (diff < 0) {
					resultMessages = resultMessages.slice(-count)
				}
			} else {
				resultMessages = []
			}
			return resultMessages
		},

		getLabels: () => {
			return labels
		},

		getChatLabels: (chatId: string) => {
			return labelAssociations.filter((la: LabelAssociation) => la.chatId === chatId).all()
		},

		getMessageLabels: (messageId: string) => {
			const associations = labelAssociations
				.filter((la: any) => la.messageId === messageId)
				.all()
			return associations.map(({ labelId }: { labelId: string }) => labelId)
		},

		loadMessage: async (jid: string, id: string) => messages[jid]?.get(id),

		mostRecentMessage: async (jid: string) => {
			const message = messages[jid]?.array.slice(-1)[0]
			return message
		},

		fetchImageUrl: async (jid: string, sock?: any) => {
			const contact = contacts[jid]
			if (!contact) {
				return sock?.profilePictureUrl(jid)
			}
			if (typeof contact.imgUrl === 'undefined') {
				contact.imgUrl = await sock?.profilePictureUrl(jid)
			}
			return contact.imgUrl
		},

		fetchGroupMetadata: async (jid: string, sock?: any) => {
			if (!groupMetadata[jid]) {
				const metadata = await sock?.groupMetadata(jid)
				if (metadata) {
					groupMetadata[jid] = metadata
				}
			}
			return groupMetadata[jid]
		},

		fetchMessageReceipts: async ({ remoteJid, id }: { remoteJid: string; id: string }) => {
			const list = messages[remoteJid]
			const msg = list?.get(id)
			return (msg as any)?.userReceipt
		},

		toJSON,
		fromJSON,

		writeToFile: (path: string) => {
			writeFileSync(path, JSON.stringify(toJSON()))
		},

		readFromFile: (path: string) => {
			if (existsSync(path)) {
				logger.debug({ path }, 'reading from file')
				try {
					const jsonStr = readFileSync(path, { encoding: 'utf-8' })
					if (jsonStr.trim().length) {
						const json = JSON.parse(jsonStr)
						fromJSON(json)
					} else {
						logger.warn({ path }, 'skipping empty json file')
					}
				} catch (err) {
					logger.warn({ path, err }, 'failed to parse json from file')
				}
			}
		}
	}
}
