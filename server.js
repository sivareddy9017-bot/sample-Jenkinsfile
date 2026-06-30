const instana = require('@instana/collector');

// MUST be first
instana({
    tracing: {
        enabled: true
    }
});

const { MongoClient } = require('mongodb');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});

const expLogger = expPino({ logger });

const app = express();

app.use(expLogger);

app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

app.use((req, res, next) => {
    try {
        let dcs = [
            "asia-northeast2",
            "asia-south1",
            "europe-west3",
            "us-east1",
            "us-west1"
        ];

        let span = instana.currentSpan();
        if (span) {
            span.annotate(
                'custom.sdk.tags.datacenter',
                dcs[Math.floor(Math.random() * dcs.length)]
            );
        }
    } catch (e) {
        // ignore tracing errors in tests
    }

    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ---------------- Mongo Setup ----------------
let collection;
let mongoConnected = false;

async function mongoConnect() {
    try {
        const mongoURL =
            process.env.MONGO_URL ||
            'mongodb://mongodb:27017/catalogue';

        const client = await MongoClient.connect(mongoURL);
        const db = client.db('catalogue');
        collection = db.collection('products');

        mongoConnected = true;
        logger.info('MongoDB connected');
    } catch (error) {
        mongoConnected = false;
        logger.error('ERROR', error);
        setTimeout(mongoConnect, 2000);
    }
}

mongoConnect();

// ---------------- Routes ----------------

// Health
app.get('/health', (req, res) => {
    res.json({
        app: 'OK',
        mongo: mongoConnected
    });
});

// Products
app.get('/products', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('database not available');
        return res.status(500).send('database not available');
    }

    try {
        const products = await collection.find({}).toArray();
        res.json(products);
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// Product by SKU
app.get('/product/:sku', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('database not available');
        return res.status(500).send('database not available');
    }

    try {
        const product = await collection.findOne({ sku: req.params.sku });

        req.log.info('product', product);

        if (product) {
            res.json(product);
        } else {
            res.status(404).send('SKU not found');
        }
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// Categories
app.get('/categories', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('database not available');
        return res.status(500).send('database not available');
    }

    try {
        const categories = await collection.distinct('categories');
        res.json(categories);
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// Search
app.get('/search/:text', async (req, res) => {
    if (!mongoConnected) {
        req.log.error('database not available');
        return res.status(500).send('database not available');
    }

    try {
        const hits = await collection
            .find({ $text: { $search: req.params.text } })
            .toArray();

        res.json(hits);
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// ---------------- IMPORTANT FIX ----------------
// Prevent server start during Jest tests
const port = process.env.CATALOGUE_SERVER_PORT || 8080;

if (require.main === module) {
    app.listen(port, () => {
        logger.info('Started on port', port);
    });
}

module.exports = app;