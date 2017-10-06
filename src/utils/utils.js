const util = require('util');
const fs = require('fs');
const zlib = require('zlib');
const unzip = require('unzip');

const readFile = util.promisify(fs.readFile);

module.exports = new class Utils {

    constructor() {
        this._datasetsConfig = JSON.parse(fs.readFileSync('./datasets_config.json', 'utf8'));
        this._serverConfig = JSON.parse(fs.readFileSync('./server_config.json', 'utf8'));
    }

    readAndGunzip(path) {
        return new Promise((resolve, reject) => {
            let buffer = [];
            fs.createReadStream(path)
                .pipe(new zlib.createGunzip())
                .on('error', err => {
                    reject(err);
                })
                .on('data', data => {
                    buffer.push(data);
                })
                .on('end', () => {
                    resolve(buffer);
                });
        });
    }

    readAndUnzip(path) {
        return new Promise((resolve, reject) => {
            fs.createReadStream(path + '.zip')
                .pipe(unzip.Extract({ path: path + '_tmp' }))
                .on('close', () => {
                    resolve();
                });
        });
    }

    aggregateRTData(static_data, rt_data, timestamp) {
        // Index map for the static fragment
        let static_index = this.getStaticIndex(static_data);
        // Index map for the rt fragment
        let rt_index = this.getRTIndex(rt_data, timestamp);
        // Iterate over the RT index which contains all the connections that need to be updated or included
        for (let [connId, index] of rt_index) {
            // If the connection is already present in the static fragment just update its values
            if (static_index.has(connId)) {
                let std = static_data[static_index.get(connId)];
                let rtd = rt_data[index];
                std['departureTime'] = rtd['departureTime'];
                std['arrivalTime'] = rtd['arrivalTime'];
                std['departureDelay'] = rtd['departureDelay'];
                std['arrivalDelay'] = rtd['arrivalDelay'];
                static_data[static_index.get(connId)] = std;
            } else {
                // Is not present in the static fragment which means it's a connection that belongs to
                // previous fragment but the delays made it belong to this one, so inlcude it at the end.
                let rtd = rt_data[index];
                delete rtd['mementoVersion'];
                static_data.push(rtd);
            }
        }
    
        // Re-sort the fragment with the updated delay data
        static_data.sort((a, b) => {
            let a_date = new Date(a['departureTime']).getTime();
            let b_date = new Date(b['departureTime']).getTime();
            return a_date - b_date;
        });
    
        return static_data;
    }

    getStaticIndex(fragment) {
        try {
            let map = new Map();
            for (let x in fragment) {
                let conn = fragment[x];
                map.set(conn['@id'], x);
            }
            return map;
        } catch (err) {
            throw err;
        }
    }

    getRTIndex(array, timeCriteria) {
        let map = new Map();
        for (let i in array) {
            try {
                let jo = array[i];
                let memento_date = new Date(jo['mementoVersion']);
                if (memento_date <= timeCriteria) {
                    map.set(jo['@id'], i);
                } else {
                    break;
                }
            } catch (err) {
                continue;
            }
        }
        return map;
    }

    async addHydraMetada(params) {
        try {
            let template = await readFile('./statics/skeleton.jsonld', { encoding: 'utf8' });
            let jsonld_skeleton = JSON.parse(template);
            let host = params.host;
            let agency = params.agency;
            let departureTime = params.departureTime;
            let version = params.version;

            jsonld_skeleton['@id'] = host + agency + '/connections?departureTime=' + departureTime.toISOString();
            jsonld_skeleton['hydra:next'] = host + agency + '/connections?departureTime='
                + this.getAdjacentPage(params.storage, agency + '/' + version, departureTime, true);
            jsonld_skeleton['hydra:previous'] = host + agency + '/connections?departureTime='
                + this.getAdjacentPage(params.storage, agency + '/' + version, departureTime, false);
            jsonld_skeleton['hydra:search']['hydra:template'] = host + agency + '/connections/{?departureTime}';
            jsonld_skeleton['@graph'] = params.data;

            params.http_response.set(params.http_headers);
            params.http_response.json(jsonld_skeleton);

        } catch (err) {
            console.error(err);
            throw err;
        }
    }

    // TODO: Make fragmentation criteria configurable
    getAdjacentPage(storage, path, departureTime, next) {
        var date = new Date(departureTime.toISOString());
        if (next) {
            date.setMinutes(date.getMinutes() + 10);
        } else {
            date.setMinutes(date.getMinutes() - 10);
        }
        while (!fs.existsSync(storage + '/linked_pages/' + path + '/' + date.toISOString() + '.jsonld.gz')) {
            if (next) {
                date.setMinutes(date.getMinutes() + 10);
            } else {
                date.setMinutes(date.getMinutes() - 10);
            }
        }
        return date.toISOString();
    }

    get datasetsConfig() {
        return this._datasetsConfig;
    }

    get serverConfig() {
        return this._serverConfig;
    }
}