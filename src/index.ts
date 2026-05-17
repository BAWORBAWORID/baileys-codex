import chalk from 'chalk'

import makeWASocket from './Socket/index'

console.log(chalk.blue('▄▀█ █░░ █░█░█ ▄▀█ █▄█ █▀ ▄ █▀▀ ██ █▀▄ █▀▀ ▀▄▀'))
console.log(chalk.blue('█▀█ █▄▄ ▀▄▄▀ ██ ░█░ ▄█ ░░ █▄▄ █▄█ █▄▀ ██▄ █░█'))
console.log(chalk.hex('#6f00ff')('Baileys v7.0.0-rc11 — A WebSockets library for interacting with WhatsApp Web'))
console.log(chalk.hex('#6f00ff')(`${chalk.bold('GitHub:')} https://github.com/WhiskeySockets/Baileys`))

export * from '../WAProto/index.js'
export * from './Utils/index'
export * from './Types/index'
export * from './Defaults/index'
export * from './WABinary/index'
export * from './WAM/index'
export * from './WAUSync/index'
export * from './Store/index'

export type WASocket = ReturnType<typeof makeWASocket>
export { makeWASocket }
export default makeWASocket
