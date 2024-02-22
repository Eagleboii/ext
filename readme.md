# Ezeep Blue Chrome Extension

Extension to print from your chrome book by using your Ezeep-Account


### Download
For using these chrome extension you can download the [Ezeep Blue Chrome Extension](https://chrome.google.com/webstore/detail/ezeep-blue/cjmopihpekddjpbjpoejdaeoipndhkgd) from chrome web store.

### Build new version
- Merge your changes into the release branch or create a new release branch (e.g. release/2.0)
- build is done by gitlab-ci triggered by push or merge, upload to Chrome Store can be triggered done manually in pipeline
- You find your new version on [Nexus](https://ctd-sv01.thinprint.de:440/#browse/browse:releases:ezeep%2Fchrome-ext) and in Chrome

### Deploy new version
Trigger in Gitlab-CI Pipeline


### Build locally (no uglify)
build.sh

## helpful build helper for browser extensions (thx CaZan)

https://oss.mobilefirst.me/extension-cli/

## Setup and Dev Env
Load and Debug like so:
https://developer.chrome.com/docs/extensions/mv2/tut_debugging/

- go to chrome://extensions/
- check "developer mode"
- load unpacked extension (select the src folder)

#### Important:
You need to add your specific redirect uri consistent, of your individual app ID (see ID in chrome://extensions/ tab under ezeep Blue extension) and .chromiumapp.org/oauth2, to the auth client.
Example: https://oelgbfobbpjofhnidwadwadmigkbfohpki.chromiumapp.org/oauth2

## redirect urls set in the backend and clientID:

https://eojfkbfdagabbigkmobgomamcmhbboof.chromiumapp.org/oauth2
https://dkbkbofcmoncdiiocgfdmojelimgjfpn.chromiumapp.org/oauth2
https://cjmopihpekddjpbjpoejdaeoipndhkgd.chromiumapp.org/oauth2
https://jnpdfgmcddejhlkgomaneoblhkmooeeh.chromiumapp.org/oauth2
https://oelgbfobbpjofhniemoeamigkbfohpki.chromiumapp.org/oauth2

## clientID: j6fFRUNhuksqyxZSIHSOBAVvDG3MAXhADSAwkei2
