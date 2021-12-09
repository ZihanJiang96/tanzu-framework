load("@ytt:data", "data")
load("@ytt:regexp", "regexp")
load("@ytt:assert", "assert")

#export
values = data.values
kappNamespace = ""
if hasattr(values.kappController, 'namespace') and values.kappController.namespace:
    kappNamespace = values.kappController.namespace
else:
    kappNamespace = values.namespace
end

def generateBashCmdForDNS(serviceCIDR):
    regexp.match('^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)([/][0-3][0-2]?|[/][1-2][0-9]|[/][0-9])?$', serviceCIDR) or assert.fail("Please provider a valid service CIDR")

    coreDNSIP = serviceCIDR[: serviceCIDR.rfind(".")] + ".10"

    # This command added the coreDNS IP as the first entry of resolv.conf
    # In this way, Kapp Controller will have cluster IP access,
    # and still be able to resolve enternal urls while core DNS is unavailable
    return "cp /etc/resolv.conf /etc/resolv.conf.bak; sed '1 i nameserver " + coreDNSIP + "' /etc/resolv.conf.bak > /etc/resolv.conf;"
end
