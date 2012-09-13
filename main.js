// Copyright 2012 Joyent, Inc.  All rights reserved.

var cluster = require('cluster');
var os = require('os');
var path = require('path');

var d = require('dtrace-provider');
var Logger = require('bunyan');
var nopt = require('nopt');
var restify = require('restify');

var app = require('./lib').app;



///--- Globals

var DEFAULT_CFG = __dirname + '/etc/cloudapi.config.json';
var LOG;
var PARSED;


var opts = {
    'debug': Boolean,
    'file': String,
    'port': Number,
    'help': Boolean
};

var shortOpts = {
    'd': ['--debug'],
    'f': ['--file'],
    'p': ['--port'],
    'h': ['--help']
};



///--- Helpers

function usage(code, message) {
    var _opts = '';
    Object.keys(shortOpts).forEach(function (k) {
        var longOpt = shortOpts[k][0].replace('--', '');
        var type = opts[longOpt].name || 'string';
        if (type && type === 'boolean') type = '';
        type = type.toLowerCase();

        _opts += ' [--' + longOpt + ' ' + type + ']';
    });

    var msg = (message ? message + '\n' : '') +
        'usage: ' + path.basename(process.argv[1]) + _opts;

    process.stderr.write(msg + '\n');
    process.exit(code);
}


function run() {
    return app.createServer({
        config: PARSED.file || DEFAULT_CFG,
        overrides: PARSED,
        log: LOG,
    }, function (server) {
        server.start(function () {
            LOG.info('CloudAPI listening at %s', server.url);
        });

        return server;
    });
}

///--- Mainline

PARSED = nopt(opts, shortOpts, process.argv, 2);
if (PARSED.help)
    usage(0);

LOG = new Logger({
    level: (PARSED.debug ? 'trace' : 'info'),
    name: 'CloudAPI',
    stream: process.stderr,
    serializers: restify.bunyan.serializers
});

if (PARSED.debug) {
    run();
} else if (cluster.isMaster) {
    var min_child_ram = 64 * 1024,
        cpus = os.cpus().length,
        slots = Math.ceil(os.totalmem() / min_child_ram),
        max_forks = (cpus >= slots) ? slots : cpus;

    for (var i = 0; i < max_forks; i++) {
        cluster.fork();
    }

    cluster.on('death', function (worker) {
        LOG.error({worker: worker}, 'worker %d exited');
    });

} else {
    run();
}
