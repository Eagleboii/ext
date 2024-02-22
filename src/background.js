// "use strict";

var configPath = './data/environment.json'
var config = {
    api_url: '',
    account_url: '',
    client_id: '',
    portal_url: '',
    print_service_url: ''
}
var jwt = {}
var jobId
const max_refresh_retries = 3

const printJobDetail = {
    jobId: '',
    fileName: '',
    printerName: 'None',
    printJobTimeStamp: (new Date()).toDateString(),
    printJobTimeValue: (new Date()).getTime(),
    printJobStatusDescription: '',
    printJobStatus: 999,
    in_progress: true
}

var activePrinterListArray = [];

loadConfig();

function fetchInterceptor(url, options) {
    const maxRefreshRetries = 3;
    // Replace with the desired number of retries  
    let retryCount = options._retry === undefined ? maxRefreshRetries : options._retry;
    if (options.noAuth === null || !options.noAuth) {
        options.headers = { ...options.headers, 'Authorization': 'Bearer ' + jwt.access_token };
    }
    const originalFetch = fetch.bind(null, url, options);
    const handleResponse = (response) => {
        if (!response.ok && response.status === 401 && retryCount > 0) {
            retryCount--;
            return refreshToken().then(() => originalFetch(url, options)).then(handleResponse);
        } else if (!response.ok && response.status === 401) {
            show_notlogged_message();
        }
        return response;
    };
    return originalFetch(url, options).then(handleResponse);
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

    /**
     *
     * TODO
     *
     * - use 'chrome.browserAction.setIcon' when extension has an activity (= print job list)
     *
     */

    // chrome.extension.getBackgroundPage().console.log( "request: ", request);
    if (request == "config") {
        loadConfig(function () { sendResponse(config); });
    } else if (request == "token") {
        getFreshToken(function () { sendResponse(jwt); });
    } else if (request == "login") {
        login(function () { sendResponse(jwt); });
        //sendResponse(jwt);
    } else if (request == "logout") {
        logout();
        sendResponse(jwt);
    } else if (request == "print_v1_users_me") {
        printV1UsersMe(function (data) { sendResponse(data); });
    } else if (request == "auth_v1_session_token") {
        authV1SessionToken()
            .then(async response => {
                let jResponse = await response.json()
                sendResponse({ status: 201, ...jResponse })
            });
    }

    return true;
});

function show_notlogged_message() {
    chrome.notifications.create("", {
        type: "basic",
        title: chrome.i18n.getMessage("notification_title_general_error"),
        message: chrome.i18n.getMessage("notification_message_error_login"),
        iconUrl: "../images/icons/ezeep-icon-24@2x.png"
    });
}

function printV1UsersMe(callback) {
    fetchInterceptor(config.print_service_url + "v1/users/me/",{})  
    .then(response => {
            if (response.ok || response.status == 200) {
                (data) => {
                    callback(data);
                }
            }
        })
}

function authV1SessionToken() {
    return fetchInterceptor(config.account_url + 'v1/session_tokens/', {
        method: 'POST'
    })
}

chrome.printerProvider.onGetPrintersRequested.addListener(
    function (resultCallback) {
        //if user is not logged return empty list of printers
        // if (!jwt.access_token) {
        //     show_notlogged_message()
        //     resultCallback([])
        // }
        // make sure token is valid and fresh and then //Get Printer
        getFreshToken(function () { getPrinterList(resultCallback) })
    }
);

chrome.printerProvider.onGetCapabilityRequested.addListener(
    function (printerId, resultCallback) {
        getFreshToken(function () {
            getPrinterProperties(printerId, function (properties) {
                // chrome.extension.getBackgroundPage().console.log(properties);
                resultCallback(properties);
            });
        })
    }
);

chrome.printerProvider.onPrintRequested.addListener(
    function (printJob, resultCallback) {
        getFreshToken(function () {
            var fdata = new FormData();
            var blob = new Blob();

            var azfileid = '';
            var azsasuri = '';

            blob = printJob.document;
            var currentjPrintJobDetail = sendDisplayJobMessage(printJob);
            fdata.append('uploadFile', blob, 'document.pdf');

            if ((jwt.access_token != "") && (jwt.access_token != undefined)) {
                // prepare
                PrepareUpload(
                    function (code) {
                        chrome.notifications.create('upload', {
                            type: "basic",
                            title: chrome.i18n.getMessage("notification_title_general_error"),
                            message: chrome.i18n.getMessage("notification_message_general_error"),
                            iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                        });
                        currentjPrintJobDetail.in_progress = false
                        resetToDefaultIcon()
                        savePrintJob(currentjPrintJobDetail)
                    },
                    function (data) {
                        azfileid = data.fileid;
                        azsasuri = data.sasUri;
                        // chrome.extension.getBackgroundPage().console.log(azfileid);
                        // chrome.extension.getBackgroundPage().console.log(azsasuri);
                        //upload ->                             // print
                        uploadDocument(fdata, azsasuri,
                            function () {
                                printDocument(azfileid, printJob, currentjPrintJobDetail,
                                    function () {
                                        // chrome.extension.getBackgroundPage().console.log('Print request send')
                                        chrome.notifications.create("notification_message_job_sent", {
                                            type: "basic",
                                            title: chrome.i18n.getMessage("notification_title_job_sent"),
                                            message: chrome.i18n.getMessage("notification_message_job_sent"),
                                            iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                                        });
                                    })
                            },
                            function () {
                                currentjPrintJobDetail.in_progress = false
                                resetToDefaultIcon()
                                savePrintJob(currentjPrintJobDetail)
                            });
                    }
                )
            }

            resultCallback('OK'); //[OK, FAILED, INVALID_TICKET, INVALID_DATA]
        })
    });

function sendDisplayJobMessage(printJob) {
    let result = Object.assign({}, printJobDetail);
    result.fileName = printJob.title;
    result.in_progress = true
    result.printJobTimeValue = (new Date()).getTime()
    result.printJobTimeStamp = (new Date()).toDateString();
    result.printJobStatusDescription = "Uploading the document";
    //resetToDefaultIcon();
    changeIcon();
    savePrintJob(result);
    return result
}

function getPrinterProperties(printerId, callBack) {
    let default_properties = {
        version: "1.0",
        printer: {
            copies: {
                default: 1
            },
            color: {
                option: [
                    { "type": "STANDARD_MONOCHROME" }
                ]
            },
            collate: {
                default: true
            },
            media_size: {
                option: [{
                    name: "NA_LETTER",
                    width_microns: 215900,
                    height_microns: 279400,
                    is_default: true
                },
                {
                    name: "ISO_A4",
                    width_microns: 210000,
                    height_microns: 297000,
                    is_default: false
                }
                ]
            },
            supported_content_type: [{
                content_type: "application/pdf",
                min_version: "1.5"
            },
            {
                content_type: "text/plain"
            }
            ]
        }
    };

    //request printer properties
    fetchInterceptor(config.api_url + "sfapi/GetPrinterProperties/?id=" + printerId, {
        method: 'GET',
        // headers: {
        //     'Content-Type': 'application/json',
        //     'Authorization': 'Bearer ' + jwt.access_token
        // },
    }
    )
        .then(response => {
            if (response.status == 500) {
                () => {
                    let message_setup = {
                        type: "basic",
                        title: chrome.i18n.getMessage("notification_title_general_error"),
                        message: chrome.i18n.getMessage("notification_message_general_error"),
                        iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                    };
                    chrome.notifications.create(text, message_setup);
                }
            }

            if (response.status == 200) {
                response.json().then(data => {
                    // chrome.extension.getBackgroundPage().console.log(data, data.length);
                    console.log(data, data.length);

                    if (data.length > 0) {
                        printJobDetail.printerName = data[0].Name
                        let properties = setPrinterProperties(data);//translate ezeep printer properties to CDD
                        callBack(properties);
                    } else {
                        let message_setup = {
                            type: "basic",
                            title: chrome.i18n.getMessage("notification_title_no_printer_properties_found"),
                            message: chrome.i18n.getMessage("notification_message_no_printer_properties_found"),
                            iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                        };

                        chrome.notifications.create("notification_message_no_printers_found", message_setup);
                        callBack(default_properties);
                    }
                })

            }
        })
}


function setPrinterProperties(ezeepPrinterProperties) {
    let properties = {
        version: "1.0",
        printer: {
            copies: {
                default: 1
            },
            collate: {
                default: ezeepPrinterProperties[0].Collate
            },
            duplex: {
                option: [
                    { "type": "NO_DUPLEX", "is_default": true }
                ]
            },
            color: {
                option: [
                    { "type": "STANDARD_MONOCHROME" }
                ]
            },
            media_size: {
                option: [
                ]
            },
            supported_content_type: [{
                content_type: "application/pdf",
                min_version: "1.5"
            },
            {
                content_type: "text/plain"
            }
            ]
        }
    };

    if (ezeepPrinterProperties[0].Color) {
        properties.printer.color.option.push({ "type": "STANDARD_COLOR", "is_default": true });
    }

    if (ezeepPrinterProperties[0].OrientationsSupported) {
        properties.printer.page_orientation = { option: [] };
        if (ezeepPrinterProperties[0].OrientationsSupported.includes("portrait")) {
            properties.printer.page_orientation.option.push({ "type": "PORTRAIT" });
        }
        if (ezeepPrinterProperties[0].OrientationsSupported.includes("landscape")) {
            properties.printer.page_orientation.option.push({ "type": "LANDSCAPE" });
        }
    }

    if (ezeepPrinterProperties[0].DuplexSupported) {
        if (ezeepPrinterProperties[0].DuplexMode == 2) {
            properties.printer.duplex.option.push({ "type": "LONG_EDGE", "is_default": true });
            properties.printer.duplex.option.push({ "type": "SHORT_EDGE" });
        }
        if (ezeepPrinterProperties[0].DuplexMode == 3) {
            properties.printer.duplex.option.push({ "type": "LONG_EDGE" });
            properties.printer.duplex.option.push({ "type": "SHORT_EDGE", "is_default": true });
        }
        else {
            properties.printer.duplex.option.push({ "type": "LONG_EDGE" });
            properties.printer.duplex.option.push({ "type": "SHORT_EDGE" });
        }
    }

    console.log('language: ' + chrome.i18n.getUILanguage())
    if (ezeepPrinterProperties[0].PaperFormats.length > 0) {
        let has_default = false
        ezeepPrinterProperties[0].PaperFormats.forEach(function (format) {
            if (format.Id == 256) return
            let is_default = false
            if (ezeepPrinterProperties[0].hasOwnProperty('PaperFormatsIdDefault') ?
                (ezeepPrinterProperties[0].PaperFormatsIdDefault == format.Id) :
                (chrome.i18n.getUILanguage() == "en-US" ? (format.Name == "Letter" || format.Name == 'Letter (8.5 x 11")') :
                    (format.Name == "A4" || format.Name == "A4 (210 x 297mm)"))) {
                is_default = !has_default
                has_default = true
            }
            properties.printer.media_size.option.push({
                name: "CUSTOM",
                custom_display_name: format.Name,
                width_microns: format.XRes * 100,
                height_microns: format.YRes * 100,
                vendor_id: format.Id,
                is_default: is_default
            });


        });
    }

    return properties;
}

uploadDocument = (fdata, azsasuri, onSuccess, onFail) => {
    fetchInterceptor(azsasuri, {
        method: 'PUT',
        headers: {
            'x-ms-blob-type': 'BlockBlob'
        },
        // url: azsasuri,
        // type: "PUT",
        // processData: false,
        noAuth: true,
        // headers: {
        //     'x-ms-blob-type': 'BlockBlob',
        // },
        body: fdata,
    })
        .then(response => {
            if (response.status == 201) {
                () => {
                    return
                }
            }
            if (response.status == 401) {
                () => {
                    onFail();
                }
            }
            if (response.status == 500) {
                () => {
                    onFail();
                }
            }
        })
        .then(function () {
            onSuccess()
            // chrome.extension.getBackgroundPage().console.log('Document uploaded');
        });
}

function printDocument(azfileid, printJob, currentjPrintJobDetail, success) {
    currentjPrintJobDetail.printJobStatusDescription = "Starting printing...";
    currentjPrintJobDetail.in_progress = true;
    changeIcon();
    savePrintJob(currentjPrintJobDetail);



    var orientationValue = 0; // default portrait

    if (printJob.ticket.print.page_orientation !== undefined) {
        orientationValue = printJob.ticket.print.page_orientation.type == "PORTRAIT" ? 1 : 2;
    }

    fetchInterceptor(config.api_url + "sfapi/Print/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
            // 'Authorization': 'Bearer ' + jwt.access_token
        },
        body: JSON.stringify({
            fileid: azfileid,
            type: "pdf",
            printerid: printJob.printerId,
            alias: currentjPrintJobDetail.fileName,
            properties: {
                color:
                    printJob.ticket.print.color &&
                        printJob.ticket.print.color.type == "STANDARD_MONOCHROME"
                        ? false
                        : true,
                copies: printJob.ticket.print.copies
                    ? printJob.ticket.print.copies.copies
                    : 1,
                duplex:
                    printJob.ticket.print.duplex &&
                        printJob.ticket.print.duplex.type == "NO_DUPLEX"
                        ? false
                        : true,
                duplexmode:
                    printJob.ticket.print.duplex &&
                        printJob.ticket.print.duplex.type == "LONG_EDGE"
                        ? 2
                        : printJob.ticket.print.duplex &&
                            printJob.ticket.print.duplex.type == "SHORT_EDGE"
                            ? 3
                            : undefined,
                orientation: orientationValue,
                paperid: printJob.ticket.print.media_size.vendor_id
            }
        })
    })
        .then(function (response) {
            if (response.ok) {
                return response.json();
            } else {
                throw new Error("Request failed with status code " + response.status);
            }
        })
        .then(function (data) {
            console.log(data)
            printJobStatus(data.jobid, currentjPrintJobDetail);
        })
        .catch(function (error) {
            console.log(error)
            currentjPrintJobDetail.in_progress = false;
            resetToDefaultIcon();
            savePrintJob(currentjPrintJobDetail);
            resetToDefaultIcon();
            generate_notification(
                chrome.i18n.getMessage("notification_title_error_general"),
                chrome.i18n.getMessage("notification_message_error_login")
            );
            logout();
        })
        .finally(function () {
            success();
        });
}

PrepareUpload = (onFail, onSuccess) => {
    fetchInterceptor(config.api_url + "sfapi/PrepareUpload/", {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + jwt.access_token
        },
    })
        .then(response => {
            if (response.status == 401) {
                () => {
                    onFail(401);
                }
            }
            if (response.status == 500) {
                () => {
                    onFail(500);
                }
            }
            if (response.status == 200) {
                response.json().then(data => {
                    onSuccess(data);
                })
            }
        })
}

function printJobStatus(jobid, currentjPrintJobDetail) {
    console.log('printjob status')
    fetchInterceptor(config.api_url + "sfapi/Status/?id=" + encodeURIComponent(jobid), {
        method: 'GET',
        // headers: {
        //     'Content-Type': 'application/json',
        //     // 'Authorization': 'Bearer ' + jwt.access_token
        // },
    }
    )
        .then(response => {
            if (response.status == 401) {
                () => {
                    resetToDefaultIcon()
                    chrome.notifications.create('401-jobstatus', {
                        type: "basic",
                        title: chrome.i18n.getMessage("notification_title_general_error"),
                        message: chrome.i18n.getMessage("notification_message_general_error"), iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                    });
                }
            }
            if (response.status == 500) {
                () => {
                    resetToDefaultIcon()
                    chrome.notifications.create('500-jobstatus', {
                        type: "basic",
                        title: chrome.i18n.getMessage("notification_title_general_error"),
                        message: chrome.i18n.getMessage("notification_message_general_error"), iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                    });
                }
            }
            if (response.status == 200) {
                response.json().then(data => {
                    currentjPrintJobDetail.jobId = jobid;
                    currentjPrintJobDetail.printJobStatus = data.jobstatus

                    if (data.jobstatus == 129) {
                        let statusPrinting = ({ currentPage, totalPage }) => `Printing ${currentPage} of ${totalPage}.`
                        currentjPrintJobDetail.printJobStatusDescription = [{
                            currentPage: data.jobpagesprinted,
                            totalPage: data.jobpagestotal
                        }]
                            .map(statusPrinting).join('');
                        // id job status is in progress- iterate until we get another status
                        savePrintJob(currentjPrintJobDetail)
                        printJobStatus(jobid, currentjPrintJobDetail);
                        return;
                    } else if (data.jobstatus == 1246) {
                        currentjPrintJobDetail.printJobStatusDescription = 'Requesting Printjob Info';
                        savePrintJob(currentjPrintJobDetail)
                        printJobStatus(jobid, currentjPrintJobDetail);
                        return;

                    } else if (data.jobstatus == 0) {
                        currentjPrintJobDetail.printJobStatusDescription = 'INFO: print job successfully finished';
                    } else if (data.jobstatus == 3001) {
                        currentjPrintJobDetail.printJobStatusDescription = 'ERROR: something went wrong - restart print job';
                    } else if (data.code == 87) {
                        currentjPrintJobDetail.printJobStatusDescription = 'ERROR: invalid job id';
                    } else {
                        currentjPrintJobDetail.printJobStatusDescription = 'ERROR: invalid print job identifier';
                    }
                    currentjPrintJobDetail.in_progress = false
                    resetToDefaultIcon()
                    savePrintJob(currentjPrintJobDetail)
                }
                )
            }

        })
}

function savePrintJob(currentPrintJob) {
    chrome.storage.local.get({ 'activeJobDetails': [] }, (items) => {
        let activeJobsArray = items.activeJobDetails
        let new_printJob = true
        let has_info_update = false
        activeJobsArray = activeJobsArray.map(x => {
            if (x.fileName == currentPrintJob.fileName &&
                x.printJobTimeValue &&
                x.printJobTimeValue === currentPrintJob.printJobTimeValue) {
                new_printJob = false

                if (x.printJobStatus !== currentPrintJob.printJobStatus
                    || x.printJobStatusDescription !== currentPrintJob.printJobStatusDescription)
                    has_info_update = true

                return Object.assign({}, currentPrintJob) //update other info
            } else {
                return x
            }
        })

        if (new_printJob) {
            if (activeJobsArray.length >= 5) {
                activeJobsArray.shift();
            }
            activeJobsArray = [currentPrintJob].concat(activeJobsArray);
        }

        activeJobsArray.sort((x, y) => {
            if (x.printJobTimeValue > y.printJobTimeValue) return 1
            if (x.printJobTimeValue < y.printJobTimeValue) return -1
            return 0
        })

        chrome.storage.local.set({ 'activeJobDetails': activeJobsArray }, function () {
            chrome.runtime.sendMessage({
                msg: 'savePrintJob',
                printJobs: activeJobsArray,
                currentPrintJob: currentPrintJob,
                has_info_update: has_info_update,
                new_printJob: new_printJob
            });
        });
    });
}

function logout() {
    jwt = {}
    saveToken(jwt)

    try {
        chrome.identity.removeCachedAuthToken();
    } catch (e) { console.log(e) }
    try {
        chrome.identity.logout();
    } catch (e) { console.log(e) }

    setTimeout(function () {
        generate_notification(chrome.i18n.getMessage("notification_title_loggedout"), chrome.i18n.getMessage("notification_message_loggedout"))
        chrome.runtime.reload();
    }, 2000);
}

function refreshToken(callback) {
    console.log("refresh token");
    fetch(config.account_url + "oauth/access_token/", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(config.client_id + ':')
        },
        body: 'grant_type=refresh_token&refresh_token=' + jwt.refresh_token
    })
        .then(function (response) {
            if (response.ok) {
                return response.json();
            } else if (response.status === 400) {
                generate_notification(chrome.i18n.getMessage("notification_title_error_general"), chrome.i18n.getMessage("notification_message_error_login"));
                logout();
                throw new Error('Bad request');
            } else {
                throw new Error('Network response was not ok');
            }
        })
        .then(function (data) {
            data.expiration_date = getExpirationDate(data);
            jwt = data;
            saveToken(jwt);
            callback();
        })
        .catch(function (error) {
            console.log('Error:', error.message);
        });
}

login = (callback) => {
    let redirect_url = chrome.identity.getRedirectURL("oauth2");
    let auth_url = config.account_url + "oauth/authorize/" + "?client_id=" + config.client_id + "&redirect_uri=" + redirect_url + "&response_type=code&prompt=select_account";

    // chrome.extension.getBackgroundPage().console.log(redirect_url, auth_url);
    // console.log(redirect_url, auth_url);
    chrome.identity.launchWebAuthFlow({
        'url': auth_url,
        'interactive': true
    },
        function (responseUrl) {
            // chrome.extension.getBackgroundPage().console.log("responseUrl: ", responseUrl);
            console.log(responseUrl);
            if (!responseUrl) {
                // chrome.extension.getBackgroundPage().console.log("responseUrl not found");
            }
            let code = responseUrl.match(/\?code=([\w\/\-]+)/)[1];
            // chrome.extension.getBackgroundPage().console.log("code:", code);

            fetch(config.account_url + 'oauth/access_token/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + btoa(config.client_id + ':')
                },
                body: new URLSearchParams({
                    'grant_type': 'authorization_code',
                    'code': code
                })
            })
                .then(response => {
                    if (response.ok) {
                        return response.json().then(data => {
                            jwt = data;
                            saveToken(jwt);
                            generate_notification(chrome.i18n.getMessage("notification_title_loggedin"), chrome.i18n.getMessage("notification_message_loggedin"));
                            show_user_portal_notification();
                            callback("OK");
                        });
                    } else if (response.status === 400) {
                        generate_notification(chrome.i18n.getMessage("notification_title_error_general"), chrome.i18n.getMessage("notification_message_error_login"));
                        logout();
                        callback("ERROR");
                    }
                })
        }
    )
}

function getFreshToken(onSuccess) {
    chrome.storage.sync.get(['access_token', 'expiration_date', 'refresh_token'], function (data) {
        // hast token
        if (data && data.access_token && jwt.access_token != "") {
            // never ever log tokens !
            // chrome.extension.getBackgroundPage().console.log( "store: ", data);
            jwt = data;

            let timeNow = (new Date()).getTime();
            // chrome.extension.getBackgroundPage().console.log({ 'timenow':timeNow, 'expiration_date': jwt.expiration_date });
            // if token to old => refresh
            if (timeNow >= jwt.expiration_date) {
                refreshToken(function () { onSuccess() });
            } else {
                onSuccess()
            }

        }
        // has no token
        else {
            jwt = {}
            saveToken(jwt)
            onSuccess()
        }
    })
}


function generate_notification(title, text) {

    let message_setup = {

        type: "basic",
        title: title,
        message: text,
        iconUrl: "../images/icons/ezeep-icon-24@2x.png"

    };
    chrome.notifications.create(text, message_setup);

}

function show_user_portal_notification() {
    let userPortalNotificationID = null;
    // TODO add text to locales
    chrome.notifications.create("", {
        type: "basic",
        iconUrl: "../images/icons/ezeep-icon-24@2x.png",
        title: "View and Change Printers",
        message: "You can use your ezeep user portal to see and if permitted change the printers which will be available for printing.",
        buttons: [{
            title: "Yes, bring me to my User Portal",
        }]
    }, function (id) {
        userPortalNotificationID = id;
    });
    chrome.notifications.onClicked.addListener(function (notifId, btnIdx) {
        if (notifId === userPortalNotificationID) {
            if (btnIdx === 0) {
                window.open(config.portal_url);
            }
        }
    });
}

function getExpirationDate(data) {
    let datenow = new Date(Date.now());
    let expireDate = datenow.setTime(datenow.getTime() + 1000 * data.expires_in);
    return expireDate;
}


function loadConfig(callback) {
    let url = chrome.runtime.getURL(configPath);
    fetch(url)
        .then(function (response) {
            return response.json()
        })
        .then(function (response) {
            // chrome.extension.getBackgroundPage().console.log(response);
            console.log(response);

            config.account_url = response.account_url;
            config.api_url = response.api_url;
            config.client_id = response.client_id;
            config.portal_url = response.portal_url;
            config.print_service_url = response.print_service_url;
        })
        .then(function () { if (callback) callback() });
}

function getPrinterList(callback) {
    if (!jwt && !jwt.access_token)
        return;

    let printers = [];
    fetchInterceptor(config.api_url + "sfapi/GetPrinter", {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + jwt.access_token
        },
    })
        .then(response => {  
            if (response.status == 500) {
                let message_setup = {
                    type: "basic",
                    title: chrome.i18n.getMessage("notification_title_general_error"),
                    message: chrome.i18n.getMessage("notification_message_general_error"),
                    iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                };
                chrome.notifications.create(text, message_setup);
                callback(printers);
            }
            if (response.status == 200) {
                response.json().then(data => { // Parse response body as JSON
                    console.log(data, data.length);

                    if (data.length > 0) {
                        data.forEach(function (item) {
                            printers.push({
                                id: item.id,
                                name: item.name,
                                description: item.location
                            });
                        });
                    } else {
                        let message_setup = {
                            type: "basic",
                            title: chrome.i18n.getMessage("notification_title_no_printers_found"),
                            message: chrome.i18n.getMessage("notification_message_no_printers_found"),
                            iconUrl: "../images/icons/ezeep-icon-24@2x.png"
                        };

                        chrome.notifications.create("notification_message_no_printers_found", message_setup);
                    }

                    callback(printers);
                });
            }
        });
}

function saveToken(data) {
    // chrome.storage.sync.set( jwt );  does not override old values if {} || undefined
    if (!data) {
        data = {}
    }
    data.access_token = data.access_token || '';
    data.refresh_token = data.refresh_token || '';
    data.token_type = data.token_type || '';
    data.expires_in = data.expires_in || '';
    data.scope = data.scope || '';

    chrome.storage.sync.set({ "access_token": data.access_token });
    chrome.storage.sync.set({ "refresh_token": data.refresh_token });
    chrome.storage.sync.set({ "token_type": data.token_type });
    chrome.storage.sync.set({ "expires_in": data.expires_in });
    chrome.storage.sync.set({ "scope": data.scope });
    // if ( expire_in ) calculate else ""
    data.expiration_date = data.expires_in && getExpirationDate(data) || '';
    chrome.storage.sync.set({ "expiration_date": data.expiration_date });
    jwt = data;

}

function changeIcon() {
    chrome.action.setIcon({
        path: {
            "16": "../images/icons/ezeep-icon-activity-16@2x.png",
            "48": "../images/icons/ezeep-icon-activity-24@2x.png",
            "128": "../images/icons/ezeep-icon-activity-24@2x.png"
        }
    })
}

function resetToDefaultIcon() {
    chrome.action.setIcon({
        path: {
            "16": "../images/icons/ezeep-icon-16@2x.png",
            "48": "../images/icons/ezeep-icon-24@2x.png",
            "128": "../images/icons/ezeep-icon-24@2x.png"
        }
    })
}

