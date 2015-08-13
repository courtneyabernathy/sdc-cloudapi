/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');
var test = require('tape').test;
var restify = require('restify');
var common = require('./common');
var uuid = common.uuid;
var addPackage = common.addPackage;
var machinesCommon = require('./machines/common');
var checkMachine = machinesCommon.checkMachine;


// --- Globals


var SDC_128 = common.sdc_128_package; // already loaded in PAPI

var SDC_256_INACTIVE =  {
    uuid: '4633473b-aae9-466b-8bde-3c410e5072cc',
    name: 'sdc_256_inactive',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: false
};

var SDC_256 = {
    uuid: '455fc2ef-b72e-4360-8d8e-09c589e06470',
    name: 'sdc_256',
    version: '1.0.0',
    max_physical_memory: 256,
    quota: 10240,
    max_swap: 512,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: true
};

var SDC_128_LINUX = {
    uuid: '0f06a3b8-4c54-4408-bb17-ffb34290867e',
    name: 'sdc_128_os',
    version: '1.0.0',
    os: 'linux',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 256,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    'default': false,
    vcpus: 1,
    active: true
};

var HEADNODE_UUID;
var IMAGE_UUID;
var MACHINE_UUID;

var CLIENTS;
var CLIENT;
var SERVER;


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT  = clients.user;
        SERVER  = server;

        addPackage1();

        // Add custom packages; "sdc_" ones will be owned by admin user:
        function addPackage1() {
            addPackage(CLIENT, SDC_256_INACTIVE, function (err) {
                t.ifError(err, 'Add package error');

                addPackage2();
            });
        }

        function addPackage2() {
            addPackage(CLIENT, SDC_128_LINUX, function (err) {
                t.ifError(err, 'Add package error');

                addPackage3();
            });
        }

        function addPackage3() {
            addPackage(CLIENT, SDC_256, function (err) {
                t.ifError(err, 'Add package error');
                t.end();
            });
        }
    });
});


test('Get Headnode', function (t) {
    common.getHeadnode(CLIENT, function (err, headnode) {
        t.ifError(err);
        HEADNODE_UUID = headnode.uuid;
        t.end();
    });
});


test('Get base dataset', function (t) {
    common.getBaseDataset(CLIENT, function (err, img) {
        t.ifError(err);
        IMAGE_UUID = img.id;
        t.end();
    });
});


test('ListMachines (empty)', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines Status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'body is an array');
        t.ok(!body.length, 'body array is empty');
        t.end();
    });
});


test('Create machine with inactive package', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_256_INACTIVE.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err, 'POST /my/machines with inactive package error');
        var cfg = common.getCfg();
        var capi_limits = cfg.plugins.filter(function (p) {
            return (p.name === 'capi_limits');
        })[0];
        if (capi_limits.enabled) {
            t.equal(res.statusCode, 403);
        } else {
            t.equal(res.statusCode, 409);
        }
        t.end();
    });
});


test('Create machine with os mismatch', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128_LINUX.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID,
        firewall_enabled: true
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(body.code, 'InvalidArgument');
        t.equal(body.message, 'The package and image must have the same OS, ' +
            'but package has "smartos" while image has "linux"');
        t.end();
    });
});


// NB: this test only applies if the config doesn't set
// allow_multiple_public_networks to true, which isn't set in JPC standups
test('Create machine with too many public networks', function (t) {
    var fakeNetwork = {
        'name': 'test external 2',
        'vlan_id': 613,
        'subnet': '10.66.62.0/24',
        'netmask': '255.255.255.0',
        'provision_start_ip': '10.66.62.10',
        'provision_end_ip': '10.66.62.240',
        'nic_tag': 'external',
        'owner_uuids': []
    };

    function createMachine(networkUuids, next) {
        var obj = {
            image: IMAGE_UUID,
            package: SDC_128.name,
            name: 'a' + uuid().substr(0, 7),
            server_uuid: HEADNODE_UUID,
            firewall_enabled: true,
            networks: networkUuids
        };

        CLIENT.post('/my/machines', obj, function (err, req, res, body) {
            t.ok(err);
            t.equal(err.statusCode, 409);
            t.equal(body.code, 'InvalidArgument');
            t.equal(body.message, 'Can specify a maximum of 1 public networks');
            next();
        });
    }

    function addNetwork(networkDesc, next) {
        CLIENT.napi.createNetwork(networkDesc, function (err, network) {
            t.ifError(err);
            next(null, network.uuid);
        });
    }

    function removeNetwork(networkUuid, next) {
        CLIENT.napi.deleteNetwork(networkUuid, next);
    }

    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err);

        var networkUuids = nets.map(function (net) { return net.uuid; });

        if (nets.length > 1) {
            createMachine(networkUuids, function () {
                t.end();
            });

        } else if (nets.length == 1) {
            addNetwork(fakeNetwork, function (_, newNetUuid) {
                createMachine(networkUuids.concat(newNetUuid), function () {
                    removeNetwork(newNetUuid, function () {
                        t.end();
                    });
                });
            });

        } else {
            // shouldn't end up here
            t.ok(false);
            t.end();
        }
    });
});


test('CreateMachine using invalid networks', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        server_uuid: HEADNODE_UUID,
        networks: ['8180ef72-40fa-4b86-915b-803bcf96b442'] // invalid
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'Invalid Networks'
        });

        t.end();
    });
});


test('CreateMachine using network without permissions', function (t) {
    var netDetails = {
        name: 'network-test-fake',
        vlan_id: 99,
        subnet: '10.99.66.0/24',
        provision_start_ip: '10.99.66.5',
        provision_end_ip: '10.99.66.250',
        nic_tag: 'external',
        owner_uuids: ['fbae7be9-922f-48cf-b935-e3027881fca0']
    };

    var vmDetails = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        server_uuid: HEADNODE_UUID
    };

    CLIENT.napi.createNetwork(netDetails, function (err, net) {
        t.ifError(err);

        vmDetails.networks = [net.uuid];

        CLIENT.post('/my/machines', vmDetails, function (err2, req, res, body) {
            t.ok(err2);
            t.equal(err2.statusCode, 409);
            t.deepEqual(body, {
                code: 'InvalidArgument',
                message: 'Invalid Networks'
            });

            CLIENT.napi.deleteNetwork(net.uuid, {}, function (err3) {
                t.ifError(err3);
                t.end();
            });
        });
    });
});



test('Create machine with invalid parameters', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        // Underscore will make name invalid:
        name: '_a' + uuid().substr(0, 7),
        // Obviously, not a valid UUID, but we don't want to notify customers
        // about this:
        server_uuid: '123456'
    };

    CLIENT.post({
        path: '/my/machines',
        headers: {
            'accept-version': '~6.5'
        }
    }, obj, function (err, req, res, body) {
        t.ok(err, 'POST Create machine with invalid parameters');
        t.ok(/name/.test(err.message));
        t.notOk(/server/.test(err.message));
        t.end();
    });
});


test('Create machine with invalid locality', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        server_uuid: HEADNODE_UUID,
        locality: { near: 'asdasd' }
    };

    CLIENT.post('/my/machines', obj, function (err, req, res, body) {
        t.equal(err.statusCode, 409);
        t.deepEqual(body, {
            code: 'ValidationFailed',
            message: 'Invalid VM parameters',
            errors: [ {
                field: 'locality',
                code: 'Invalid',
                message: 'locality contains malformed UUID'
            } ]
        });
        t.end();
    });
});


test('CreateMachine using dataset without permission', function (t) {
    CLIENT.imgapi.listImages(function (err, images) {
        t.ifError(err);

        var accountUuid = CLIENT.account.uuid;
        var inaccessibleImage = images.filter(function (img) {
            return img.owner !== accountUuid && !img.public;
        })[0];

        if (!inaccessibleImage) {
            // can't continue test, so move on
            return t.end();
        }

        var obj = {
            image: inaccessibleImage.uuid,
            package: SDC_128.name,
            server_uuid: HEADNODE_UUID
        };

        return CLIENT.post('/my/machines', obj, function (er2, req, res, body) {
            t.ok(er2);
            t.equal(er2.statusCode, 404);

            t.deepEqual(body, {
                code: 'ResourceNotFound',
                message: 'image not found'
            });

            t.end();
        });
    });
});


// We need to create a new user here, because the ufds entries cached
// inside cloudapi conflict with simple updates of the existing user. That
// implies skipping using the existing http client.
test('CreateMachine without approved_for_provisioning', function (t) {
    function attemptProvision(err, tmpAccount, cb) {
        t.ifError(err);

        var httpClient = restify.createJsonClient({
            url: CLIENT.url.href, // grab from old client
            retryOptions: { retry: 0 },
            log: CLIENT.log,
            rejectUnauthorized: false
        });

        // cheating a bit by using the old auth method to make things easier
        httpClient.basicAuth(tmpAccount.login, tmpAccount.passwd);

        var obj = {
            image: IMAGE_UUID,
            package: SDC_128.name,
            server_uuid: HEADNODE_UUID
        };

        httpClient.post({
            path: '/my/machines',
            headers: { 'accept-version': '~6.5' }
        }, obj, function (err2, req, res, body) {
            t.ok(err2);

            t.deepEqual(body, {
                code: 'InvalidArgument',
                message: 'User is not currently approved for provisioning'
            });

            httpClient.close();

            cb();
        });
    }

    function done() {
        t.end();
    }

    var opts = {
        approved_for_provisioning: false
    };

    common.withTemporaryUser(CLIENT.ufds, opts, attemptProvision, done);
});


// Test using IMAGE.uuid instead of IMAGE.name due to PUBAPI-625:
test('CreateMachine', function (t) {
    var obj = {
        image: IMAGE_UUID,
        package: SDC_128.name,
        name: 'a' + uuid().substr(0, 7),
        locality: { far: 'af4167f0-beda-4af9-9ae4-99d544499c14' }, // fake UUID
        server_uuid: HEADNODE_UUID,
        firewall_enabled: true
    };

    machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
        MACHINE_UUID = machineUuid;
        t.end();
    });
});


test('Wait For Running Machine 1', waitForRunning);


test('ListMachines all', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');

        body.forEach(function (m) {
            if (m.state === 'failed') {
                return;
            }

            checkMachine(t, m);
        });

        t.end();
    });
});


// Fixed by PUBAPI-774, again!
test('ListMachines (filter by dataset)', function (t) {
    searchAndCheck('image=' + IMAGE_UUID, t, function (m) {
        t.equal(m.image, IMAGE_UUID);
    });
});


test('ListMachines (filter by state)', function (t) {
    searchAndCheck('state=running', t, function (m) {
        t.equal(m.state, 'running');
    });
});


test('ListMachines (filter by memory)', function (t) {
    searchAndCheck('memory=128', t, function (m) {
        t.equal(m.memory, 128);
    });
});


test('ListMachines (filter by package)', function (t) {
    var pkgName = SDC_128.name;

    searchAndCheck('package=' + pkgName, t, function (m) {
        t.equal(m['package'], pkgName);
    });
});


test('ListMachines (filter by smartmachine type)', function (t) {
    searchAndCheck('type=smartmachine', t, function (m) {
        t.equal(m.type, 'smartmachine');
        // at the moment, only the machine created in the above tests should
        // list here:
        t.equal(m.id, MACHINE_UUID);
    });
});


test('ListMachines (filter by virtualmachine type)', function (t) {
    var path = '/my/machines?type=virtualmachine';

    return CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(Array.isArray(body));

        // at the moment, only the machine created in the above tests should
        // list, but it's not a virtualmachine, so for now:
        t.equal(body.length, 0);

        //body.forEach(function (m) {
        //    checkMachine(t, m);
        //    t.equal(m.type, 'virtualmachine');
        //});

        t.end();
    });
});


test('ListMachines (filter by bad type)', function (t) {
    var path = '/my/machines?type=0xdeadbeef';

    return CLIENT.get(path, function (err, req, res, body) {
        t.ok(err);
        t.equal(res.statusCode, 409);
        common.checkHeaders(t, res.headers);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: '0xdeadbeef is not a valid type'
        });

        t.end();
    });
});


test('Get Machine', function (t) {
    machinesCommon.getMachine(t, CLIENT, MACHINE_UUID, function (_, machine) {
        // Double check tags are OK, due to different handling by VMAPI:
        var tags = {};
        tags[machinesCommon.TAG_KEY] = machinesCommon.TAG_VAL;
        t.deepEqual(machine.tags, tags, 'Machine tags');

        t.end();
    });
});


test('Get Machine, including credentials', function (t) {
    var url = '/my/machines/' + MACHINE_UUID + '?credentials=true';

    CLIENT.get(url, function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines/:id error');
        t.equal(res.statusCode, 200, 'GET /my/machines/:id status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines/:id body');
        checkMachine(t, body);

        t.equal(typeof (body.metadata.credentials), 'object');
        Object.keys(machinesCommon.META_CREDS).forEach(function (k) {
            t.equal(body.metadata.credentials[k], machinesCommon.META_CREDS[k]);
        });

        t.end();
    });
});


test('Stop test', function (t) {
    var stopTest = require('./machines/stop');
    stopTest(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Start test', function (t) {
    var startTest = require('./machines/start');
    startTest(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Reboot test', function (t) {
    var rebootTest = require('./machines/reboot');
    rebootTest(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Resize machine to inactive package', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID, {
        action: 'resize',
        package: SDC_256_INACTIVE.name
    }, function (err, req, res, body) {
        t.ok(err, 'Resize to inactive package error');
        t.equal(res.statusCode, 409, 'Resize to inactive pkg status');
        t.end();
    });
});


test('Resize machine tests', function (t) {
    var resizeTest = require('./machines/resize');
    resizeTest(t, CLIENT, MACHINE_UUID, SDC_128, SDC_256,
        function () {
        t.end();
    });
});


test('Tags tests', function (t) {
    var testTags = require('./machines/tags');
    testTags(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Metadata tests', function (t) {
    var testMetadata = require('./machines/metadata');
    testMetadata(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Snapshots tests', function (t) {
    var testSnapshots = require('./machines/snapshots');
    testSnapshots(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('Firewall Rules tests', function (t) {
    var testFirewallRules = require('./machines/firewall-rules');
    testFirewallRules(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});



test('Delete tests', function (t) {
    var deleteTest = require('./machines/delete');
    deleteTest(t, CLIENT, MACHINE_UUID, function () {
        t.end();
    });
});


test('machine audit', function (t) {
    var p = '/my/machines/' + MACHINE_UUID + '/audit';

    CLIENT.get(p, function (err, req, res, body) {
        t.ifError(err);
        t.ok(Array.isArray(body));
        t.ok(body.length);

        var f = body[body.length - 1];
        t.ok(f.success);
        t.ok(f.time);
        t.ok(f.action);
        t.ok(f.caller);
        t.ok(f.caller.type);
        t.equal(f.caller.type, 'signature');
        t.ok(f.caller.ip);
        t.ok(f.caller.keyId);

        var expectedJobs = [
            'destroy', 'delete_snapshot', 'rollback_snapshot',
            'create_snapshot', 'replace_metadata', 'remove_metadata',
            'set_metadata', 'remove_tags', 'replace_tags', 'remove_tags',
            'set_tags', 'resize', 'reboot', 'start', 'stop', 'provision'
        ];

        for (var i = 0; i !== expectedJobs.length; i++) {
            var expected = expectedJobs[i];
            var job      = body[i];
            var caller   = job.caller;

            if (expected === 'replace_tags') {
                // since we're updating tags fairly quickly in these tests,
                // vmapi doesn't promise immediate consistency, we have to
                // accept that sometimes the replace_tags job only adds a tag
                t.ok(job.action === 'replace_tags' || job.action === 'set_tags',
                    'action');
            } else {
                t.equal(job.action, expected, 'action');
            }
            t.equal(caller.type, 'signature');
            t.ok(caller.ip, 'ip');
            t.ok(caller.keyId.indexOf('test@joyent.com/keys/id_rsa') !== -1);
        }

        t.end();
    });
});


test('ListMachines tombstone', function (t) {
    CLIENT.get('/my/machines?tombstone=20', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');
        t.ok(body.some(function (m) {
            return (m.id === MACHINE_UUID);
        }));
        t.end();
    });
});


test('ListMachines exclude tombstone', function (t) {
    CLIENT.get('/my/machines', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.notOk(body.some(function (m) {
            return (m.id === MACHINE_UUID);
        }));
        t.end();
    });
});


test('ListMachines destroyed', function (t) {
    CLIENT.get('/my/machines?state=destroyed', function (err, req, res, body) {
        t.ifError(err, 'GET /my/machines error');
        t.equal(res.statusCode, 200, 'GET /my/machines status');
        common.checkHeaders(t, res.headers);
        t.ok(body, 'GET /my/machines body');
        t.ok(Array.isArray(body), 'GET /my/machines body is array');
        t.ok(body.length, 'GET /my/machines list is not empty');
        t.ok(body.some(function (m) {
            return (m.id === MACHINE_UUID);
        }));
        t.end();
    });
});


test('CreateMachine using query args', function (t) {
    var query = '/my/machines?image=' + IMAGE_UUID +
                '&package=' + SDC_128.name +
                '&server_uuid=' + HEADNODE_UUID;

    CLIENT.post(query, {}, function (err, req, res, body) {
        t.ifError(err, 'POST /my/machines error');
        t.equal(res.statusCode, 201, 'POST /my/machines status');
        common.checkHeaders(t, res.headers);
        t.equal(res.headers.location,
            util.format('/%s/machines/%s', CLIENT.login, body.id));
        t.ok(body, 'POST /my/machines body');
        checkMachine(t, body);

        MACHINE_UUID = body.id;

        // Handy to output this to stdout in order to poke around COAL:
        console.log('Requested provision of machine: %s', MACHINE_UUID);
        t.end();
    });
});


test('Wait For Running Machine 2', waitForRunning);


test('DeleteMachine which used query args', deleteMachine);


// passing in multiple same networks should flatten to single network added
test('CreateMachine using multiple same networks', function (t) {
    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err);

        var networkUuid = nets[0].uuid;

        var obj = {
            image: IMAGE_UUID,
            package: SDC_128.name,
            server_uuid: HEADNODE_UUID,
            networks: [networkUuid, networkUuid, networkUuid]
        };

        machinesCommon.createMachine(t, CLIENT, obj, function (_, machineUuid) {
            MACHINE_UUID = machineUuid;
            // see next couple following tests for asserts
            t.end();
        });
    });
});


test('Wait For Running Machine 3', waitForRunning);


test('Check CreateMachine flattens same networks', function (t) {
    CLIENT.vmapi.getVm({ uuid: MACHINE_UUID }, function (err, vm) {
        t.ifError(err);
        t.equal(vm.nics.length, 1);
        t.end();
    });
});


test('DeleteMachine which flattened networks', deleteMachine);


test('Check resize does not affect docker machines (setup)', function (t) {
    var vmUuid = CLIENT.account.uuid;
    var vmDescription = {
        owner_uuid: vmUuid,
        uuid: uuid(),
        alias: 'cloudapi-fake-docker-test',
        internal_metadata: {
            'docker:id': vmUuid,
            'docker:tty': true,
            'docker:attach_stdin': true,
            'docker:attach_stdout': true,
            'docker:attach_stderr': true,
            'docker:open_stdin': true,
            'docker:noipmgmtd': true,
            'docker:cmd': '["/bin/bash"]',
            'docker:entrypoint': '[]'
        },
        autoboot: true, // false
        docker: true,
        brand: 'joyent-minimal',  // should be lx, but we're abusing this
        networks: [ {
            uuid: '', // filled in below
            primary: true
        } ],
        billing_id: SDC_128.uuid,
        image_uuid: IMAGE_UUID
    };

    CLIENT.napi.listNetworks({ nic_tag: 'external' }, function (err, nets) {
        t.ifError(err);

        vmDescription.networks[0].uuid = nets[0].uuid;

        CLIENT.vmapi.createVm(vmDescription, function (err2, vm) {
            t.ifError(err2);

            MACHINE_UUID = vm.vm_uuid;

            t.end();
        });
    });
});


test('Check resize does not affect docker machines (waiting)', waitForRunning);


test('Check resize does not affect docker machines (test)', function (t) {
    CLIENT.post('/my/machines/' + MACHINE_UUID, {
        action: 'resize',
        package: SDC_128_LINUX.name
    }, function (err, req, res, body) {
        t.ok(err, 'Prevent resize machine error');
        t.equal(res.statusCode, 409);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'resize is not supported for docker containers'
        });

        t.end();
    });
});


test('Check resize does not affect docker machines (teardown)', deleteMachine);


test('teardown', function (t) {
    common.deletePackage(CLIENT, SDC_256, function () {
        common.deletePackage(CLIENT, SDC_256_INACTIVE, function () {
            common.deletePackage(CLIENT, SDC_128_LINUX, function () {
                common.teardown(CLIENTS, SERVER, function () {
                    t.end();
                });
            });
        });
    });
});


// --- Helpers


function waitForRunning(t) {
    machinesCommon.waitForRunningMachine(CLIENT, MACHINE_UUID, function (err) {
        t.ifError(err);

        if (err) {
            // Skip machine tests when machine creation fails
            MACHINE_UUID = false;
        }

        t.end();
    });
}


function deleteMachine(t) {
    CLIENT.del('/my/machines/' + MACHINE_UUID, function (err, req, res) {
        t.ifError(err, 'DELETE /my/machines error');
        t.equal(res.statusCode, 204, 'DELETE /my/machines status');
        t.end();
    });
}


function searchAndCheck(query, t, checkAttr) {
    return CLIENT.get('/my/machines?' + query, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);

        t.ok(Array.isArray(body));
        t.ok(body.length > 0);

        body.forEach(function (m) {
            checkMachine(t, m);
            checkAttr(m);
        });

        t.end();
    });
}
