# RHTE API Lifecycle Demo

This repository contains all the artefacts to deliver an *API Lifecycle Demo*:
from the OpenAPI Specifications to the production in 20 minutes.

## Requirements

To setup and deliver this demo, you will need:

- an OpenShift cluster with sufficient RAM (**4GB free**), CPU (**2 vCPU**),
  and storage (a few Persistent Volumes for a total storage requirements of
  **1-2 GB**), publicly accessible on the Internet.
- a GitHub, GitLab or Bitbucket account.
- an account on [apicur.io](https://studio.apicur.io/).
- a 3scale SaaS Tenant (you can also use an on-premise tenant with minor changes)

Note: you can deliver this demo fully on-premise by if needed but you will
need to deploy also:

- a GIT repository (hint: [Gitea](https://gitea.io/))
- the 3scale API Management Platform
- the Apicurio Studio

## Setup

### 1/ Fork this repository

Fork this repository using your GitHub account or on any other GIT provider (GitLab, BitBucket, etc.).

### 2/ Create the OpenShift projects

```sh
oc new-project rhte-build --display-name="RHTE API (BUILD)"
oc new-project rhte-test --display-name="RHTE API (TEST)"
oc new-project rhte-prod --display-name="RHTE API (PROD)"
oc new-project ansible --display-name="Ansible Tower"
```

### 3/ Deploy Microcks in the BUILD environment

```sh
oc create -f https://raw.githubusercontent.com/microcks/microcks/master/install/openshift/openshift-persistent-full-template.yml -n rhte-build
```

The command below should be run by a cluster administrator because it requires to create an OAuthClient in OpenShift. In the command below, replace the variables by your values:

- `<project>` : name of project where setup is done. Here `rhte-build`.
- `<master_url>` : the HTTPS URL of OpenShift master
- `<app_host_url>` : the Host for Routes, ex `192.168.99.100.nip.io` when using CDK or Minishift.

```sh
oc new-app -n rhte-build --template=microcks-persistent --param=APP_ROUTE_HOSTNAME=microcks-<project>.<app_host_url> --param=KEYCLOAK_ROUTE_HOSTNAME=keycloak-<project>.<app_host_url> --param=OPENSHIFT_MASTER=<master_url> --param=OPENSHIFT_OAUTH_CLIENT_NAME=<project>-client
```

Create a Jenkins Master image containing Microcks plugin.

```sh
oc process -f https://raw.githubusercontent.com/microcks/microcks-jenkins-plugin/master/openshift-jenkins-master-bc.yml | oc create -f - -n rhte-build
```

Wait for build to finish.

### 4/ Deploy Jenkins in the BUILD environment

```sh
oc new-app -n rhte-build --name=jenkins  --template=jenkins-persistent --param=NAMESPACE=rhte-build --param=JENKINS_IMAGE_STREAM_TAG=microcks-jenkins-master:latest -p MEMORY_LIMIT=2Gi
oc env -n rhte-build dc/jenkins JENKINS_OPTS=--sessionTimeout=86400
```

### 5/ Give Jenkins the right to manage the TEST and PROD environments

```sh
oc adm policy add-role-to-user admin system:serviceaccount:rhte-build:jenkins -n rhte-test
oc adm policy add-role-to-user admin system:serviceaccount:rhte-build:jenkins -n rhte-prod
```

### 6/ Build the API Backend

Create a new BuildConfig to build the API Backend using your forked repository.
Do not forget to replace `https://github.com/nmasse-itix/rhte-api.git` by your
repository URL.

```sh
oc new-build -n rhte-build nodejs:8~https://github.com/nmasse-itix/rhte-api.git --strategy=source --name=rhte-api
oc start-build -n rhte-build rhte-api
```

Wait for the build to finish:

```sh
oc logs -f bc/rhte-api -n rhte-build
```

### 7/ Deploy the API Backend to the TEST and PROD environments

```sh
oc tag rhte-build/rhte-api:latest rhte-api:ready-for-test -n rhte-test
oc new-app rhte-api:ready-for-test --name rhte-api -n rhte-test
oc expose svc/rhte-api -n rhte-test
oc tag rhte-build/rhte-api:latest rhte-api:ready-for-prod -n rhte-prod
oc new-app rhte-api:ready-for-prod --name rhte-api -n rhte-prod
oc expose svc/rhte-api -n rhte-prod
```

### 8/ Remove the trigger on the TEST and PROD environments

```sh
oc set triggers dc/rhte-api --from-image=rhte-api:ready-for-test --manual=true -c rhte-api -n rhte-test
oc set triggers dc/rhte-api --from-image=rhte-api:ready-for-prod --manual=true -c rhte-api -n rhte-prod
```

### 9/ Prepare your 3scale SaaS Tenant

Create an Access Token in your 3scale SaaS Tenant that has read-write access to the Account Management API. Please check [3scale documentation](https://access.redhat.com/documentation/en-us/red_hat_3scale/2-saas/html-single/accounts/index#access_tokens) on how to get an access token. Write down this value for later use.

You will also need the name of your 3scale tenant.

On your 3scale Admin Portal, go the `Developer Portal` section and replace your standard `Documentation` page by [the content of 3scale-docs.html](3scale-docs.html).

**Do not forget to hit `Save` and `Publish`.**

### 10/ Deploy the 3scale APIcast instances in TEST and PROD

```sh
oc process -f apicast-template.yaml -p ACCESS_TOKEN=<YOUR_3SCALE_ACCESS_TOKEN> -p TENANT=<YOUR_3SCALE_TENANT> |oc create -f - -n rhte-test
oc process -f apicast-template.yaml -p ACCESS_TOKEN=<YOUR_3SCALE_ACCESS_TOKEN> -p TENANT=<YOUR_3SCALE_TENANT> |oc create -f - -n rhte-prod
```

### 11/ Create the OpenShift routes for your APIcast gateways

```sh
oc process -f apicast-routes-template.yaml -p MAJOR_VERSION=1 -p WILDCARD_DOMAIN=test.app.itix.fr | oc create -f - -n rhte-test
oc process -f apicast-routes-template.yaml -p MAJOR_VERSION=2 -p WILDCARD_DOMAIN=test.app.itix.fr | oc create -f - -n rhte-test
oc process -f apicast-routes-template.yaml -p MAJOR_VERSION=1 -p WILDCARD_DOMAIN=prod.app.itix.fr | oc create -f - -n rhte-prod
oc process -f apicast-routes-template.yaml -p MAJOR_VERSION=2 -p WILDCARD_DOMAIN=prod.app.itix.fr | oc create -f - -n rhte-prod
```

### 12/ Deploy Ansible Tower

```sh
oc project ansible
oc apply -f - <<EOF
apiVersion: "v1"
kind: "PersistentVolumeClaim"
metadata:
  name: "postgresql"
spec:
  accessModes:
    - "ReadWriteOnce"
  resources:
    requests:
      storage: "5Gi"
EOF
```

> Note: since AWX moves very fast, it is recommended to settle the version of all components.

```sh
git clone https://github.com/ansible/awx.git
git clone https://github.com/ansible/awx-logos.git
cd awx
git checkout 2b9954c .
cd installer
ansible-playbook -i inventory install.yml -e kubernetes_web_version=1.0.7.2 -e kubernetes_web_version=1.0.7.2 -e kubernetes_memcached_image=1.5.10 -e openshift_host="$(oc whoami --show-server)" -e openshift_skip_tls_verify=true -e openshift_project="$(oc project -q)" -e openshift_user="$(oc whoami)" -e openshift_token="$(oc whoami -t)" -e admin_user=admin -e admin_password=redhat123 -e awx_official=true
```

The default installation of AWX uses a combination of `latest` tags and an `imagePullPolicy` set to `always`, which is a recipe for disaster. All tags have been set explicitely on the command line earlier, now you can set the `imagePullPolicy` to `IfNotPresent`.

```sh
oc patch dc/awx --type=json -p '[ { "op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent" }, { "op": "replace", "path": "/spec/template/spec/containers/1/imagePullPolicy", "value": "IfNotPresent" }, { "op": "replace", "path": "/spec/template/spec/containers/2/imagePullPolicy", "value": "IfNotPresent" }, { "op": "replace", "path": "/spec/template/spec/containers/3/imagePullPolicy", "value": "IfNotPresent" } ]'
```

### 13/ Configure project and job in AWX

Login on AWX as admin, go to the *Projects* section and add a new project with following properties :

* Name: `Deploy API to 3scale`
* Description: `Enable continuous deployment of an API to 3scale AMP`
* Organization: `default`
* SCM Type: `Git`
* SCM URL: `https://github.com/nmasse-itix/threescale-cicd-awx`
* SCM Branch/Tag/Commit: `master`

You can also tick `Update Revision on Launch` and setup a cache timeout.

Then you have to add a new *Job Template* with following properties :

* Name: `Deploy an API to 3scale`
* Project: `Deploy API to 3scale`
* Playbook: `deploy-api.yml`
* Inventory: `Prompt on Launch`
* Extra-variables: `Prompt on Launch`

For both the TEST and PROD environments, you will have to declare an inventory into AWX.

* Create an inventory named `3scale-test` and set the `Variables` field to:

```yaml
---
ansible_connection: local
```

* Save
* Move to the `Groups` section and create a group named `threescale`
* Set the `Variables` field to:

```yaml
---
threescale_cicd_access_token: <3scale_access_token>
threescale_cicd_api_environment_name: test
threescale_cicd_wildcard_domain: test.app.itix.fr
```

* Do not forget to replace the `threescale_cicd_access_token`, `threescale_cicd_api_environment_name` and `threescale_cicd_wildcard_domain` variables with respectively your access token to 3scale API Management backend, the name of environment as well as the wildcard that will be used to serve Gateway through Route.

* Move to the `Hosts` section
* Add a host that matches your 3scale Admin Portal (`<TENANT>-admin.3scale.net`). For example: `nmasse-redhat-admin.3scale.net`

* Duplicate this inventory and change the `threescale` group variables to:

```yaml
---
threescale_cicd_access_token: <3scale_access_token>
threescale_cicd_api_environment_name: prod
threescale_cicd_wildcard_domain: prod.app.itix.fr
```

* Change the name of the new inventory to `3scale-prod` and save

### 14/ Create the Jenkins Pipeline

Create the Jenkins pipeline from your forked repository:

```sh
oc process -f pipeline-template.yaml -p GIT_REPO=https://github.com/nmasse-itix/rhte-api.git -p MICROCKS_TEST_ENDPOINT=http://$(oc get route rhte-api -n rhte-test -o jsonpath={.spec.host}) |oc create -f - -n rhte-build
```

## 15/ Jenkins setup for Ansible Tower

You finally need to configure the connection between Jenkins and AWX/Ansible Tower. To do this, go to Jenkins, click on *Manage Jenkins* > *Manage Plugins* and install the `Ansible Tower` plugin. You do not need to restart Jenkins.

Then click on *Credentials* > *System*, click on *Global credentials (unrestricted)* and select *Add Credentials...* to add a new user for connection to AWX/Ansible Tower. Fill-in your AWX/Tower Admin login and password, and choose `tower-admin` for the id field.

Finally, you also have to configure an alias to your AWX Server into Jenkins. This will allow our Jenkins pipelines to access the AWX server easily without knowing the complete server name or address. Click on *Configure System* in the management section and then go to the *Ansible Tower* section and add a new Tower Installation. Give it a name (we've simply used `tower` in our scripts), fill the URL and specify that it should be accessed using the user and credentials we have just created before.

## 16/ Load the OpenAPI Specifications to Apicurio

Go to [studio.apicur.io](https://studio.apicur.io/), login and import the three API contracts in the [api-contract](api-contract) folder.

* Go to [https://studio.apicur.io/apis/import](https://studio.apicur.io/apis/import)
* Choose `Import from URL`
* Fill-in the URL field with the raw url of the first API Contract (https://raw.githubusercontent.com/nmasse-itix/rhte-api/master/api-contracts/openapi-spec-v1.0.yaml)
* Repeat the process with the two remaining API contracts
