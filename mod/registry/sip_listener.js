/**
 * @author Pedro Sanders
 * @since v1
 */
const {
    isRegisterOk,
    isRegisterNok,
    isBehindNat,
    mustAuthenticate,
    handleAuthChallenge,
    getExpires
} = require('@routr/core/processor/processor_utils')
const {
    fixPort
} = require('@routr/utils/misc_utils')

const SDSelector = require('@routr/data_api/store_driver_selector')
const StoreAPI = require('@routr/data_api/store_api')
const InetAddress = Java.type('java.net.InetAddress')
const FromHeader = Java.type('javax.sip.header.FromHeader')
const ViaHeader = Java.type('javax.sip.header.ViaHeader')
const LogManager = Java.type('org.apache.logging.log4j.LogManager')
const LOG = LogManager.getLogger()

function storeRegistry(store, gwRef, gwURI, expires) {
    LOG.debug(`registry.listener.storeRegistry [storing gw -> ${gwURI.toString()}]`)
    const reg = {
        username: gwURI.getUser(),
        host: gwURI.getHost(),
        ip: InetAddress.getByName(gwURI.getHost()).getHostAddress(),
        //expires: actualExpires,
        expires: expires,
        registeredOn: Date.now(),
        gwRef: gwRef,
        gwURI: gwURI.toString()
    }
    store.withCollection('registry').put(gwURI.toString(), JSON.stringify(reg))
}

function removeRegistry(store, gwURI) {
    LOG.debug(`registry.listener.removeRegistry [removing gw -> ${gwURI.toString()}]`)
    store.withCollection('registry').remove(gwURI.toString())
}

module.exports = (registry, sipStack, gatewaysAPI) => {
    const SipListener = Java.extend(Java.type('javax.sip.SipListener'))
    const store = new StoreAPI(SDSelector.getDriver())
    return new SipListener({
        processResponse: event => {
            const response = event.getResponse()
            const gwURI = response.getHeader(FromHeader.NAME)
                .getAddress().getURI()
            const gwRef = event.getClientTransaction().getRequest()
                .getHeader('X-Gateway-Ref').value
            const gateway = gatewaysAPI.getGateway(gwRef).data

            try {
                if (isRegisterOk(response)) {
                    // BEWARE: This is not being cover by the SEET test. It will always
                    // be "behind nat" and registry will no be stored.
                    if (isBehindNat(response)) {
                        LOG.debug(`Routr is behind a NAT. Re-registering to '${gwRef}' using Received and RPort`)
                        const viaHeader = response.getHeader(ViaHeader.NAME)
                        const received = viaHeader.getReceived()
                        const rport = fixPort(viaHeader.getRPort())
                        registry.register(gateway, received, rport)
                        return
                    }
                    storeRegistry(store, gwRef, gwURI,
                        getExpires(response))
                } else if (isRegisterNok(response)) {
                    removeRegistry(store, gwURI)
                }

                if (mustAuthenticate(response)) {
                    handleAuthChallenge(sipStack, event, gateway)
                }
            } catch (e) {
                LOG.error(e)
            }
        }
    })
}
