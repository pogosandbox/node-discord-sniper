require('dotenv').config({silent: true});

import * as pogobuf from 'pogobuf';
import * as Discord  from 'discord.js';
import * as logger from 'winston';
import * as moment from 'moment';
import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as fs from 'fs-promise';

let yaml = require('js-yaml');

let config = null;
let bot = new Discord.Client();
let client: pogobuf.Client = null;
let lastLogin = moment();
let lastgmo = moment();
let pokemonNames = null;

async function loadConfig() {
    let exists = await fs.existsSync('config.yaml');
    if (exists) {
        let loaded = yaml.safeLoad(fs.readFileSync('config.yaml', 'utf8'));
        config = _.defaultsDeep(loaded, {
            filters: { users: null, channels: null },
        });
    }

    pokemonNames = JSON.parse(await fs.readFile('pokemons.fr.json', 'utf8'));
}

bot.on('ready', () => {
    logger.info('Discord bot ready.');
});

async function PogoLogin() {
    logger.info('Login to pogo');

    let login = new pogobuf.PTCLogin();
    if (config.proxy) login.setProxy(config.proxy);

    let token = await login.login(config.pokemongo.user, config.pokemongo.password);

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

    await client.init(false);
    await client.batchStart().batchCall();
    await client.getPlayer('FR', 'fr', 'Europe/Paris');

    lastLogin = moment();
    logger.info('Logged in.');
}

async function GoCatch(position, pokemonId, stats) {
    if (lastLogin.diff(moment(), 'minutes') >= 25) await PogoLogin();

    client.setPosition(position);
    let waitABit = lastgmo.diff(moment(), 'seconds') - 10;
    if (waitABit > 0) await Bluebird.delay(waitABit * _.random(1000, 1200));

    let cellIDs = pogobuf.Utils.getCellIDs(position.latitude, position.longitude);
    let response = await client.getMapObjects(cellIDs, Array(cellIDs.length).fill(0));
    let catchablePokemons = response.map_cells.reduce((all, c) => all.concat(c.catchable_pokemons), []);
    catchablePokemons = _.filter(catchablePokemons, pkm => pkm.pokemon_id === pokemonId);

    logger.info('%d pokemons to encounter', catchablePokemons.length);

    await Bluebird.each(catchablePokemons, async pokemon => {
        logger.info('Encounter pokemon %d', pokemon.pokemon_id);
        await Bluebird.delay(_.random(2500, 3500));

        let encounter = await client.encounter(pokemon.encounter_id, pokemon.spawn_point_id);
        let pokemonData = encounter.wild_pokemon.pokemon_data;
        if (pokemonData.individual_attack === stats.attack &&
            pokemonData.individual_defense === stats.defense &&
            pokemonData.individual_stamina === stats.stamina) {

            await Bluebird.delay(_.random(2000, 3000));
            logger.info('Catching', encounter);

        }
    });
}

bot.on('message', async message => {
    if (!config.filters.users || _.find(config.filters.users, u => u === message.author.username)) {
        if (!config.filters.channels || _.find(config.filters.channels, c => c === (<any>message.channel).name)) {
            let regex = /\: (\w+) IV .+ \((\d+)\/(\d+)\/(\d+)\) https\:\/\/www.google.com\/maps\?q=(\d+(\.\d+))%2C(\d+(\.\d+))/;
            let match = message.content.match(regex);
            if (match) {
                let pokemonId = _.findKey(pokemonNames, pkm => pkm === match[1]);
                let stats = { attack: +match[2], defense: +match[3], stamina: +match[4] };
                let coords = { latitude: parseFloat(match[5]), longitude: parseFloat(match[7]) };
                logger.info('Pokemon %d at coords', +pokemonId, coords);
                await GoCatch(coords, +pokemonId, stats);
            }
        }
    }
});

async function Main() {
    await loadConfig();
    if (!config) throw new Error('config.yaml does not exists.');

    await PogoLogin();
    await bot.login(config.discord.token);
}

Main()
.catch(e => logger.error(e));