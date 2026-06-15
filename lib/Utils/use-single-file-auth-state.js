import fs from 'fs';
import { initAuthCreds } from './auth-utils.js';
import { BufferJSON } from './generics.js';
import { proto } from '../../WAProto/index.js';

export const useSingleFileAuthState = (filename) => {
    let state = { creds: initAuthCreds(), keys: {} };
    
    if (fs.existsSync(filename)) {
        try {
            const rawData = fs.readFileSync(filename, { encoding: 'utf-8' });
            state = JSON.parse(rawData, BufferJSON.reviver);
        } catch (error) {
            console.error('Gagal membaca file sesi (Mungkin corrupt):', error);
        }
    }

    let writeTimeout = null;
    const writeData = () => {
        if (!writeTimeout) {
            writeTimeout = setTimeout(() => {
                fs.writeFileSync(filename, JSON.stringify(state, BufferJSON.replacer, 2));
                writeTimeout = null;
            }, 1000);
        }
    };

    return {
        state: {
            creds: state.creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = state.keys[`${type}-${id}`];
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                state.keys[key] = value;
                            } else {
                                delete state.keys[key];
                            }
                        }
                    }
                    writeData();
                }
            }
        },
        saveCreds: () => {
            writeData();
        }
    };
};
