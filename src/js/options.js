var jwt = { }
var config = { }

var jobId
var jobStatus
var jobStatusDescription = ''



$(document).ready(function () {
    $("#no_print_jobs").css("display","none");
    
    //load config
    chrome.runtime.sendMessage("config", function(response) {
        console.log("config: ", response)
        config = response;
        // -> then load token
        chrome.runtime.sendMessage("token", function(response) {
            // never ever log tokens !!!
            jwt = response;
            // -> then do something
            if (jwt && jwt.access_token && jwt.access_token != "") {
                //Text for logout section
                setText('#button_logout', 'innerText', 'logout');
                setText('#button_user_portal', 'innerText', 'user_portal');
                $("#loggedin_content").css("display", "block");
                $("#loggedout_content").css("display", "none");
                show_user_portal_menu_entry(jwt);
                show_printjob_status();
            } else {
                console.log( "token not found");
                setText('#ms_headline', 'innerText', 'login');
                setText('#save_credentials', 'value', 'login');
                document.getElementById('save_credentials').removeAttribute('disabled')
                $("#loggedin_content").css("display", "none");
                $("#loggedout_content").css("display", "block");
            }
        });
    });
    //Print Job Listener
    chrome.runtime.onMessage.addListener(
        (request, sender, sendResponse) => {
            if(request.msg === "savePrintJob") {
                $("#no_print_jobs").css("display","none");
                refreshPrintJobs(request.printJobs, request.currentPrintJob, request.has_info_update, request.new_printJob);
            }
        }
    );
});

$("#button_logout").click(function () {
    document.getElementById('save_credentials').removeAttribute('disabled')
    chrome.runtime.sendMessage("logout", function(response) { 
        console.log("logged out")
    });
});

document.getElementById("button_user_portal").addEventListener("click", function () {
    const sending = chrome.runtime.sendMessage("auth_v1_session_token");
    sending.then(response => {
        if (response.status === 201)
            chrome.tabs.create({ url: config.account_url + 'auth/signin/' + response.token + '/' });
    })
});

$("#save_credentials").on('click', function () {
    $("#loading_icon").css("display", "block");
    document.getElementById('save_credentials').setAttribute('disabled',true)//using vanilla js because jquery cannot set "disable='true'"", but "disable" only
    chrome.runtime.sendMessage("login", function(response) { 
        console.log("saved credentials")
        $("#loading_icon").css("display", "none");
        location.reload()
        window.close()
    });
});

$("#clear_printjobs").on('click', () => {
    chrome.storage.local.set({ 'activeJobDetails': [] }, () => {
        $("div.ezp-list-item--status").remove();
        $('#no_print_jobs').show();
        $('#total_printjobs').text('0 Printjobs');
    })
})

function show_user_portal_menu_entry(jwt) {
    chrome.runtime.sendMessage("print_v1_users_me", function(data) {
        if (data && data.myprinters_enabled) {
            $('#button_user_portal').show();
        }
    });
}

function show_printjob_status() {
    chrome.storage.local.get({'activeJobDetails':[]}, (items) => {
        if(items.activeJobDetails.length == 0) {
            $('#no_print_jobs').show();
            $('#total_printjobs').text('0 Printjobs');
            return;
        }
        $("#no_print_jobs").css("display","none");
        loadPrintJobsStorate(items.activeJobDetails);
        $('#total_printjobs').text(items.activeJobDetails.length + ' Printjobs');
    });
}

function check_mail(mail) {
    var mail_syntax = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return mail_syntax.test(mail);
}

function setText(selector, property, message) {
    var s = document.querySelector(selector);
    if (s && s[property])
        s[property] = chrome.i18n.getMessage(message);

}

function addslashes(string) {
    return string.replace(/\\/g, '\\\\').
    replace(/\u0008/g, '\\b').
    replace(/\t/g, '\\t').
    replace(/\n/g, '\\n').
    replace(/\f/g, '\\f').
    replace(/\r/g, '\\r').
    replace(/'/g, '\\\'').
    replace(/ /g, '_').
    replace(/"/g, '\\"');
}

function refreshPrintJobs(activeJobDetails, currentJob, has_info_update, new_printJob) {
    if (currentJob && has_info_update && !new_printJob) {
        let divId = '#' + 'printjob_' + currentJob.printJobTimeValue + '_status'
        $(divId).text(currentJob.printJobStatusDescription)
    }
    $('#total_printjobs').text(activeJobDetails.length + ' Printjobs');
    loadPrintJobsStorate(activeJobDetails)
}

function loadPrintJobsStorate(jobs) {
    let printJobsElements = $.makeArray($("div.ezp-list-item")
        .map((index,dom) => { 
            return {id:dom.id, inProgress:(dom.dataset.inProgress === "true")} 
        }))
    let currentJobsId = jobs.map(item => {
        return {id:"printjob_"+item.printJobTimeValue, inProgress:item.in_progress}
    })
    //remove old print jobs
    if (printJobsElements.length > 0) {
        for (let index = 0; index < printJobsElements.length; index++) {
            const item = printJobsElements[index]
            if (!currentJobsId.some((element) => element.id === item.id)) {
                $("#" + item.id).remove()
            }
            //remove in-progress job after the print job is done
            if(currentJobsId.some((element) => element.id === item.id && element.inProgress !== item.inProgress)) {
                $("#" + item.id).remove()
            }
        }
    }

    //add the new ones
    for (let index = 0; index < jobs.length; index++) {
        const item = jobs[index];

        if (printJobsElements.length === 0 ||
            !printJobsElements.some((element) => element.id === "printjob_" + item.printJobTimeValue) ||
            printJobsElements.some((element) => element.id === "printjob_" + item.printJobTimeValue && element.inProgress !== item.in_progress)) {
            if (item.in_progress) {
                setOnGoingPrintJobs(item)
            } else {
                setOldPrintJobs(item)
            }
        }
    }
}

function setOldPrintJobs(element) {
    const htmlItem = ({ fileName, timeValue, timeStamp, statusDescription, svg, status }) => `
        <div class="ezp-list-item ezp-list-item--status ezp-list-item--${status}" id="printjob_${timeValue}" data-in-progress="false">
            <div class="ezp-list-item__content">    
                <div class="ezp-list-item__title">
                    <span class="ezp-label ezp-label--primary ezp-label--soft">${fileName}</span>
                </div>
                <div class="ezp-list-item__meta">
                    <span class="ezp-label ezp-label--secondary ezp-label--soft">${timeStamp}</span>
                </div>
                <div class="ezp-list-item__meta">
                    <span id="printjob_${timeValue}_status" class="ezp-label ezp-label--secondary ezp-label--soft">${statusDescription}</span>
                </div>
            </div>
            <svg class="ezp-icon"><use xlink:href="${svg}"></use></svg>
        </div>
        `
    $('#display_finished_printjob').prepend([
        {
            fileName: element.fileName,
            timeValue: element.printJobTimeValue,
            timeStamp: element.printJobTimeStamp,
            statusDescription: element.printJobStatus == 0 ? 'Printed on: ' + element.printerName : 'Printing failed on: ' + element.printerName,
            svg: element.printJobStatus == 0 ? '#ezp-glyph-check' : '#ezp-glyph-exclamation',
            status: element.printJobStatus == 0 ? 'success' : 'failed'
        }
    ].map(htmlItem).join(''))
}

function setOnGoingPrintJobs(element) {
    const htmlItem = ({ fileName, timeValue, timeStamp, statusDescription }) => `
        <div class="ezp-list-item" id="printjob_${timeValue}" data-in-progress="true">
            <div class="ezp-list-item__content">
                <div class="ezp-list-item__title">
                    <span class="ezp-label ezp-label--primary ezp-label--soft">${fileName}</span>
                </div>
                <div class="ezp-list-item__meta">
                    <span iclass="ezp-label ezp-label--secondary ezp-label--soft">${timeStamp}</span>
                </div>
                <div class="ezp-list-item__meta">
                    <span id="printjob_${timeValue}_status" class="ezp-label ezp-label--secondary ezp-label--soft">${statusDescription}</span>
                </div>
                <div class="ezp-progress">
                    <div class="ezp-progress__inner">
                    <div class="ezp-progress__track"></div>
                    </div>
                </div>
            </div>
        </div>
        `
    $('#display_in_progress_printjob').prepend([
        {
            fileName: element.fileName,
            timeValue: element.printJobTimeValue,
            timeStamp: element.printJobTimeStamp,
            statusDescription: element.printJobStatusDescription
        }
    ].map(htmlItem).join(''))
}
