#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# Copyright (c) 2011 Joyent Inc., All rights reserved.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

role=cloudapi
# Local SAPI manifests:
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/$role
# This is just shortest
SVC_ROOT=/opt/smartdc/$role

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/boot/lib/util.sh
sdc_common_setup

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/$role
mkdir -p /opt/smartdc/$role/ssl

/usr/bin/chown -R root:root /opt/smartdc

echo "Generating SSL Certificate"
/opt/local/bin/openssl req -x509 -nodes -subj '/CN=*' -newkey rsa:2048 \
    -keyout /opt/smartdc/$role/ssl/key.pem \
    -out /opt/smartdc/$role/ssl/cert.pem -days 365

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/smartdc/$role/build/node/bin:/opt/smartdc/$role/node_modules/.bin" >>/root/.profile

# Make sure we have our log file
touch /var/svc/log/smartdc-application-cloudapi:default.log

logadm -w cloudapi -C 48 -s 100m -p 1h \
            /var/svc/log/smartdc-application-cloudapi:default.log

# setup haproxy
function setup_cloudapi {
    local cloudapi_instances=4

    #Build the list of ports.  That'll be used for everything else.
    local ports
    for (( i=1; i<=$cloudapi_instances; i++ )); do
        ports[$i]=`expr 8080 + $i`
    done

    #To preserve whitespace in echo commands...
    IFS='%'

    #haproxy
    for port in "${ports[@]}"; do
        hainstances="$hainstances        server cloudapi-$port 127.0.0.1:$port check inter 10s slowstart 10s error-limit 3 on-error mark-down\n"
    done

    sed -e "s#@@CLOUDAPI_INSTANCES@@#$hainstances#g" \
        $SVC_ROOT/etc/haproxy.cfg.in > $SVC_ROOT/etc/haproxy.cfg || \
        fatal "could not process $src to $dest"

    svccfg import $SVC_ROOT/smf/manifests/haproxy.xml || \
        fatal "unable to import haproxy"
    svcadm enable "cloudapi/haproxy" || fatal "unable to start haproxy"

    #cloudapi instances
    local cloudapi_xml_in=$SVC_ROOT/smf/manifests/cloudapi.xml.in
    for port in "${ports[@]}"; do
        local cloudapi_instance="cloudapi-$port"
        local cloudapi_xml_out=$SVC_ROOT/smf/manifests/cloudapi-$port.xml
        sed -e "s#@@CLOUDAPI_PORT@@#$port#g" \
            -e "s#@@CLOUDAPI_INSTANCE_NAME@@#$cloudapi_instance#g" \
            -e "s/@@PREFIX@@/\/opt\/smartdc\/cloudapi/g" \
            $cloudapi_xml_in  > $cloudapi_xml_out || \
            fatal "could not process $cloudapi_xml_in to $cloudapi_xml_out"

        svccfg import $cloudapi_xml_out || \
            fatal "unable to import $cloudapi_instance: $cloudapi_xml_out"
        svcadm enable "$cloudapi_instance" || \
            fatal "unable to start $cloudapi_instance"

    done

    unset IFS
}

setup_cloudapi

# Install Amon monitor and probes for CloudAPI
TRACE=1 /opt/smartdc/cloudapi/bin/cloudapi-amon-install

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0