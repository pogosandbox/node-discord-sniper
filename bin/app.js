"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
require('dotenv').config({ silent: true });
const pogobuf = require("pogobuf");
const Discord = require("discord.js");
const logger = require("winston");
const moment = require("moment");
const _ = require("lodash");
const Bluebird = require("bluebird");
const fs = require("fs-promise");
let yaml = require('js-yaml');
let config = null;
let bot = new Discord.Client();
let client = null;
let lastLogin = moment();
let lastgmo = moment();
let pokemonNames = null;
function loadConfig() {
    return __awaiter(this, void 0, void 0, function* () {
        let exists = yield fs.existsSync('config.yaml');
        if (exists) {
            let loaded = yaml.safeLoad(fs.readFileSync('config.yaml', 'utf8'));
            config = _.defaultsDeep(loaded, {
                filters: { users: null, channels: null },
            });
        }
        pokemonNames = JSON.parse(yield fs.readFile('pokemons.fr.json', 'utf8'));
    });
}
bot.on('ready', () => {
    logger.info('Discord bot ready.');
});
function PogoLogin() {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info('Login to pogo');
        let login = new pogobuf.PTCLogin();
        if (config.proxy)
            login.setProxy(config.proxy);
        let token = yield login.login(config.pokemongo.user, config.pokemongo.password);
        client = new pogobuf.Client({
            deviceId: config.pokemongo.deviceId,
            authType: 'ptc',
            authToken: token,
            version: 5702,
            useHashingServer: true,
            hashingKey: config.pokemongo.hashKey,
            mapObjectsThrottling: false,
            includeRequestTypeInResponse: true,
            proxy: process.env.PROXY,
        });
        client.setPosition(config.pokemongo.initialPosition);
        yield client.init(false);
        yield client.batchStart().batchCall();
        yield client.getPlayer('FR', 'fr', 'Europe/Paris');
        lastLogin = moment();
        logger.info('Logged in.');
    });
}
function GoCatch(position, pokemonId, stats) {
    return __awaiter(this, void 0, void 0, function* () {
        if (lastLogin.diff(moment(), 'minutes') >= 25)
            yield PogoLogin();
        client.setPosition(position);
        let waitABit = lastgmo.diff(moment(), 'seconds') - 10;
        if (waitABit > 0)
            yield Bluebird.delay(waitABit * _.random(1000, 1200));
        let cellIDs = pogobuf.Utils.getCellIDs(position.latitude, position.longitude);
        let response = yield client.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
        let catchablePokemons = response.map_cells.reduce((all, c) => all.concat(c.catchable_pokemons), []);
        catchablePokemons = _.filter(catchablePokemons, pkm => pkm.pokemon_id === pokemonId);
        logger.info('%d pokemons to encounter', catchablePokemons.length);
        yield Bluebird.each(catchablePokemons, (pokemon) => __awaiter(this, void 0, void 0, function* () {
            logger.info('Encounter pokemon %d', pokemon.pokemon_id);
            yield Bluebird.delay(_.random(2500, 3500));
            let encounter = yield client.encounter(pokemon.encounter_id, pokemon.spawn_point_id);
            let pokemonData = encounter.wild_pokemon.pokemon_data;
            if (pokemonData.individual_attack === stats.attack &&
                pokemonData.individual_defense === stats.defense &&
                pokemonData.individual_stamina === stats.stamina) {
                yield Bluebird.delay(_.random(2000, 3000));
                logger.info('Catching', encounter);
            }
        }));
    });
}
bot.on('message', (message) => __awaiter(this, void 0, void 0, function* () {
    if (!config.filters.users || _.find(config.filters.users, u => u === message.author.username)) {
        if (!config.filters.channels || _.find(config.filters.channels, c => c === message.channel.name)) {
            let regex = /\: (\w+) IV .+ \((\d+)\/(\d+)\/(\d+)\) https\:\/\/www.google.com\/maps\?q=(\d+(\.\d+))%2C(\d+(\.\d+))/;
            let match = message.content.match(regex);
            if (match) {
                let pokemonId = _.findKey(pokemonNames, pkm => pkm === match[1]);
                let stats = { attack: +match[2], defense: +match[3], stamina: +match[4] };
                let coords = { latitude: parseFloat(match[5]), longitude: parseFloat(match[7]) };
                logger.info('Pokemon %d at coords', +pokemonId, coords);
                yield GoCatch(coords, +pokemonId, stats);
            }
        }
    }
}));
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield loadConfig();
        if (!config)
            throw new Error('config.yaml does not exists.');
        yield PogoLogin();
        yield bot.login(config.discord.token);
    });
}
Main()
    .catch(e => logger.error(e));
//# sourceMappingURL=app.js.map