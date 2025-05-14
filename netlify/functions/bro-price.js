const TelegramBot = require('node-telegram-bot-api');
const Pact = require('pact-lang-api');
const {MongoClient} = require('mongodb');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

const NETWORK_ID = process.env.NETWORK_ID;
const API_HOST = process.env.API_HOST;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const BRO_MAINNET_KEY = process.env.BRO_MAINNET_KEY;
const BRO = `${BRO_MAINNET_KEY}.bro`;
const BRO_TREASURY = `${BRO_MAINNET_KEY}.bro-treasury`;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

const KEY_PAIR = {
    publicKey: PUBLIC_KEY,
    secretKey: SECRET_KEY,
};

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {polling: false});

let db;

const creationTime = () => Math.round(new Date().getTime() / 1000);

async function getTokenDetails() {
    const cmd = {
        networkId: NETWORK_ID,
        keyPairs: [KEY_PAIR],
        pactCode: `(let ((acct (${BRO_TREASURY}.dex-account)))
                 (round (/ (coin.get-balance acct)
                           (${BRO}.get-balance acct))
                        2))`,
        envData: {},
        meta: {
            creationTime: creationTime(),
            ttl: 600,
            gasLimit: 150000,
            chainId: '18',
            gasPrice: 0.0000001,
            sender: KEY_PAIR.publicKey,
        },
    };

    try {
        const result = await Pact.fetch.local(cmd, API_HOST);
        return result.result?.data;
    } catch (error) {
        console.error('Error fetching token details:', error);
        return null;
    }
}

async function saveTokenPrice(updatedBroPrice) {
    try {
        console.log('Updated BRO Price:', updatedBroPrice);

        // Delete all records in the collection
        await db.collection(COLLECTION_NAME).deleteMany({});

        // Insert the new token price
        await db.collection(COLLECTION_NAME).insertOne({
            price: updatedBroPrice,
            timestamp: new Date(),
        });
    } catch (error) {
        console.error('Error saving token price to MongoDB:', error);
    }
}

async function getPreviousTokenPrice() {
    try {
        const lastEntry = await db.collection(COLLECTION_NAME)
            .find({})
            .sort({timestamp: -1})
            .limit(1)
            .toArray();
        return lastEntry[0]?.price || 0;
    } catch (error) {
        console.error('Error retrieving previous token price from MongoDB:', error);
        return null;
    }
}

async function handlePriceAlert(currentPrice, previousPrice) {

    const priceDifference = Math.abs(previousPrice - currentPrice);

    if (priceDifference > 50) {
        const status = currentPrice < previousPrice ? 'dropped' : 'raised';
        const message = `BRO price ${status} from ${previousPrice} KDA to ${currentPrice} KDA`;

        await bot.sendMessage(TELEGRAM_GROUP_ID, message);
        // Save the current BRO price to MongoDB
        await saveTokenPrice(currentPrice);
    }
}

exports.handler = async function () {
    let client;
    try {
        // Connect to MongoDB
        client = new MongoClient(MONGODB_URI);
        db = client.db(DB_NAME);

        // Fetch current BRO price
        const currentPrice = await getTokenDetails();

        if (currentPrice !== null) {
            // Get previous BRO price from MongoDB
            const previousPrice = await getPreviousTokenPrice();

            // Handle price alert based on the previous price
            await handlePriceAlert(currentPrice, previousPrice);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({message: `BRO price ${currentPrice} KDA`}),
        };
    } catch (error) {
        console.error('Error in handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({message: 'Internal Server Error'}),
        };
    } finally {
        // Ensure MongoDB connection is closed
        if (client) {
            await client.close();
        }
    }
};
