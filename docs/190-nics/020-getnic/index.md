Title: GetNic (GET /:login/machines/:id/nics/:mac)
---
Text:

Gets a specific NIC on a machine belonging to a given account.

NB: the `:mac` element in the path must have all the colons (':') stripped from
it in the request.

### Inputs

* None

### Returns

A NIC object:

||**Field**||**Type**||**Description**||
||ip ||String||NIC's IPv4 address||
||mac||String||NIC's MAC address||
||primary||Boolean||Whether this is the VM's primary NIC||
||netmask||String||IPv4 netmask||
||gateway||String||IPv4 gateway||
||state||String||Describes the state of the NIC (e.g. provisioning, running, or stopped)||

### Errors

For all possible errors, see [CloudAPI HTTP Responses](#cloudapi-http-responses).

||**Error Code**||**Description**||
||ResourceNotFound||If `:login`, `:id`, or `:mac` does not exist||
||InvalidArgument||If `:id` isn't a UUID, or `:mac` isn't a MAC address (without colons)||

### CLI

    $ sdc-nics get 90:b8:d0:2f:b8:f9 76a533e9-aa3c-4fd4-a194-03fa05663e0e

#### Example Request

    GET /my/machine/76a533e9-aa3c-4fd4-a194-03fa05663e0e/nics/90b8d02fb8f9 HTTP/1.1
    authorization: Signature keyId="...
    accept: application/json
    accept-version: ~7.1
    host: api.example.com
    connection: keep-alive

#### Example Response

    HTTP/1.1 200 OK
    content-type: application/json
    content-length: 284
    date: Sat, 03 May 2014 13:37:36 GMT
    access-control-allow-origin: *
    access-control-allow-headers: Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, Api-Version, Response-Time
    access-control-allow-methods: GET, HEAD, DELETE
    access-control-expose-headers: Api-Version, Request-Id, Response-Time
    connection: Keep-Alive
    content-md5: ahIN4rEEcEIJGltGn9cqRQ==
    server: Joyent SmartDataCenter 7.1.1
    api-version: 7.2.0
    request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    response-time: 183
    x-resource-count: 1
    x-request-id: 6b8c5170-d45a-11e3-8db6-c7649670227d
    x-api-version: 7.2.0
    x-response-time: 183

    {
        "mac": "90:b8:d0:2f:b8:f9",
        "primary": true,
        "ip": "10.88.88.137",
        "netmask": "255.255.255.0",
        "gateway": "10.88.88.2",
        "state": "running"
    }

