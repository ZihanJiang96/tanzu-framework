import { Component, OnInit, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { APIClient } from 'src/app/swagger';

import { AzureWizardFormService } from 'src/app/shared/service/azure-wizard-form.service';
import { WizardBaseDirective } from '../wizard/shared/wizard-base/wizard-base';
import { Observable, EMPTY, throwError, of } from 'rxjs';
import { CliGenerator, CliFields } from '../wizard/shared/utils/cli-generator';
import { AzureRegionalClusterParams } from 'src/app/swagger/models';
import { AzureAccountParamsKeys } from './provider-step/azure-provider-step.component';
import { FormMetaDataService } from 'src/app/shared/service/form-meta-data.service';
import { EXISTING } from './vnet-step/vnet-step.component';
import Broker from 'src/app/shared/service/broker';
import { ImportParams, ImportService } from "../../../shared/service/import.service";

// Not sure why some of these step names have 'Form' in them, but leaving as is
enum AzureStep {
    PROVIDER = 'azureProviderForm',
    NODESETTING = 'azureNodeSettingForm',
    METADATA = 'metadataForm',
    NETWORK = 'networkForm',
    CEIP = 'ceipOptInForm',
    IDENTITY = 'identity',
    OSIMAGE = 'osImage',
    VNET = 'vnetForm'
}

enum AzureForm {
    PROVIDER = 'azureProviderForm',
    NODESETTING = 'azureNodeSettingForm',
    METADATA = 'metadataForm',
    NETWORK = 'networkForm',
    CEIP = 'ceipOptInForm',
    IDENTITY = 'identityForm',
    OSIMAGE = 'osImageForm',
    VNET = 'vnetForm'
}

@Component({
    selector: 'app-azure-wizard',
    templateUrl: './azure-wizard.component.html',
    styleUrls: ['./azure-wizard.component.scss']
})
export class AzureWizardComponent extends WizardBaseDirective implements OnInit {
    region: string;

    constructor(
        router: Router,
        public wizardFormService: AzureWizardFormService,
        private importService: ImportService,
        private formBuilder: FormBuilder,
        private apiClient: APIClient,
        titleService: Title,
        formMetaDataService: FormMetaDataService,
        el: ElementRef) {

        super(router, el, formMetaDataService, titleService);

        this.form = this.formBuilder.group({
            azureProviderForm: this.formBuilder.group({}),
            vnetForm: this.formBuilder.group({}),
            azureNodeSettingForm: this.formBuilder.group({}),
            workerazureNodeSettingForm: this.formBuilder.group({}),
            metadataForm: this.formBuilder.group({}),
            networkForm: this.formBuilder.group({}),
            identityForm: this.formBuilder.group({}),
            osImageForm: this.formBuilder.group({}),
            ceipOptInForm: this.formBuilder.group({})
        });
    }

    ngOnInit() {
        super.ngOnInit();
        this.titleService.setTitle(this.title + ' Azure');
    }

    getStepDescription(stepName: string): string {
        if (stepName === AzureStep.PROVIDER) {
            const tenant = this.getFieldValue(AzureForm.PROVIDER, 'tenantId');
            return tenant ? `Azure tenant: ${tenant}` : 'Validate the Azure provider credentials for Tanzu';
        } else if (stepName === AzureStep.VNET) {
            const vnetCidrBlock = this.getFieldValue(stepName, "vnetCidrBlock");
            if (vnetCidrBlock) {
                return `Subnet: ${vnetCidrBlock}`;
            }
            return "Specify a Azure VNET CIDR";
        } else if (stepName === AzureStep.NODESETTING) {
            const controlPlaneSetting = this.getFieldValue(stepName, "controlPlaneSetting");
            if (controlPlaneSetting) {
                return `Control plane type: ${controlPlaneSetting}`;
            }
            return `Specifying the resources backing the ${this.clusterTypeDescriptor} cluster`;
        } else if (stepName === AzureStep.METADATA) {
            const location = this.getFieldValue(stepName, "clusterLocation");
            if (location) {
                return `Location: ${location}`;
            }
            return `Specify metadata for the ${this.clusterTypeDescriptor} cluster`;
        } else if (stepName === AzureStep.NETWORK) {
            const serviceCidr = this.getFieldValue(stepName, "clusterServiceCidr");
            const podCidr = this.getFieldValue(stepName, "clusterPodCidr");
            if (serviceCidr && podCidr) {
                return `Cluster service CIDR: ${serviceCidr} Cluster POD CIDR: ${podCidr}`;
            }
            return "Specify how TKG networking is provided and global network settings";
        } else if (stepName === AzureStep.CEIP) {
            return "Join the CEIP program for TKG";
        } else if (stepName === AzureStep.IDENTITY) {
            if (this.getFieldValue(AzureForm.IDENTITY, 'identityType') === 'oidc' &&
                this.getFieldValue(AzureForm.IDENTITY, 'issuerURL')) {
                return 'OIDC configured: ' + this.getFieldValue(AzureForm.IDENTITY, 'issuerURL')
            } else if (this.getFieldValue(AzureForm.IDENTITY, 'identityType') === 'ldap' &&
                this.getFieldValue(AzureForm.IDENTITY, 'endpointIp')) {
                return 'LDAP configured: ' + this.getFieldValue(AzureForm.IDENTITY, 'endpointIp') + ':' +
                this.getFieldValue(AzureForm.IDENTITY, 'endpointPort');
            } else {
                return 'Specify identity management'
            }
        } else if (stepName === AzureStep.OSIMAGE) {
            if (this.getFieldValue(AzureForm.OSIMAGE, 'osImage') && this.getFieldValue(AzureForm.OSIMAGE, 'osImage').name) {
                return 'OS Image: ' + this.getFieldValue(AzureForm.OSIMAGE, 'osImage').name;
            } else {
                return 'Specify the OS Image';
            }
        }
        return `Step ${stepName} is not supported yet`;
    }

    getPayload(): any {
        const payload: AzureRegionalClusterParams = {};

        payload.azureAccountParams = {};
        AzureAccountParamsKeys.forEach(key => {
            payload.azureAccountParams[key] = this.getFieldValue(AzureForm.PROVIDER, key);
        });

        const mappings = [
            ["location", AzureForm.PROVIDER, "region"],
            ["sshPublicKey", AzureForm.PROVIDER, "sshPublicKey"],
        ];

        mappings.forEach(attr => payload[attr[0]] = this.getFieldValue(attr[1], attr[2]));

        payload.controlPlaneMachineType = this.getControlPlaneNodeType("azure");
        payload.controlPlaneFlavor = this.getControlPlaneFlavor("azure");
        payload.workerMachineType = Broker.appDataService.isModeClusterStandalone() ? payload.controlPlaneMachineType :
            this.getFieldValue(AzureForm.NODESETTING, 'workerNodeInstanceType');
        payload.machineHealthCheckEnabled = this.getBooleanFieldValue(AzureForm.NODESETTING, "machineHealthChecksEnabled");

        const resourceGroupOption = this.getFieldValue(AzureForm.PROVIDER, "resourceGroupOption");
        const resourceGroupField = resourceGroupOption === 'existing' ? 'resourceGroupExisting' : 'resourceGroupCustom';
        payload.resourceGroup = this.getFieldValue(AzureForm.PROVIDER, resourceGroupField);
        payload.clusterName = this.getMCName();

        // Retrieve vnet info
        payload.vnetResourceGroup = this.getFieldValue(AzureForm.VNET, 'vnetResourceGroup');

        const vnetOption = this.getFieldValue(AzureForm.VNET, "vnetOption");
        let vnetAttrs = [       // For new vnet
            ["vnetName", AzureForm.VNET, "vnetNameCustom"],
            ["vnetCidr", AzureForm.VNET, "vnetCidrBlock"],
            ["controlPlaneSubnet", AzureForm.VNET, "controlPlaneSubnetNew"],
            ["controlPlaneSubnetCidr", AzureForm.VNET, "controlPlaneSubnetCidrNew"],
            ["workerNodeSubnet", AzureForm.VNET, "workerNodeSubnetNew"],
            ["workerNodeSubnetCidr", AzureForm.VNET, "workerNodeSubnetCidrNew"],
        ];

        if (vnetOption === EXISTING) {        // for existing vnet
            vnetAttrs = [
                ["vnetName", AzureForm.VNET, "vnetNameExisting"],
                ["vnetCidr", AzureForm.VNET, "vnetCidrBlock"],
                ["controlPlaneSubnet", AzureForm.VNET, "controlPlaneSubnet"],
                ["controlPlaneSubnetCidr", AzureForm.VNET, "controlPlaneSubnetCidr"],
                ["workerNodeSubnet", AzureForm.VNET, "workerNodeSubnet"],
            ];
        }
        vnetAttrs.forEach(attr => payload[attr[0]] = this.getFieldValue(attr[1], attr[2]));

        payload.enableAuditLogging = this.getBooleanFieldValue(AzureForm.NODESETTING, "enableAuditLogging");

        this.initPayloadWithCommons(payload);

        // private Azure cluster support
        payload.isPrivateCluster = this.getBooleanFieldValue(AzureForm.VNET, "privateAzureCluster");

        payload.frontendPrivateIp = "";
        if (payload.isPrivateCluster) {
            payload.frontendPrivateIp = this.getFieldValue(AzureForm.VNET, "privateIP");
        }

        return payload;
    }

    setFromPayload(payload: AzureRegionalClusterParams) {
        if (payload !== undefined) {
            if (payload.azureAccountParams !== undefined) {
                for (const accountFieldName of Object.keys(payload.azureAccountParams)) {
                    // we treat azureCloud differently because it's a listbox selection where the label != key
                    if (accountFieldName !== 'azureCloud') {
                        this.saveFormField(AzureForm.PROVIDER, accountFieldName, payload.azureAccountParams[accountFieldName]);
                    }
                }
                this.saveFormListbox(AzureForm.PROVIDER, 'azureCloud', payload.azureAccountParams['azureCloud']);
            }
            this.saveFormField(AzureForm.PROVIDER, "sshPublicKey", payload["sshPublicKey"]);
            this.saveFormListbox(AzureForm.PROVIDER, "region", payload["location"]);

            this.saveControlPlaneFlavor('azure', payload.controlPlaneFlavor);
            this.saveControlPlaneNodeType('azure', payload.controlPlaneFlavor, payload.controlPlaneMachineType);

            if (!Broker.appDataService.isModeClusterStandalone()) {
                this.saveFormField(AzureForm.NODESETTING, 'workerNodeInstanceType', payload.workerMachineType);
            }
            this.saveFormField(AzureForm.NODESETTING, "machineHealthChecksEnabled", payload.machineHealthCheckEnabled);

            // Since we cannot tell if the resource group is custom or existing, we load it into the custom field.
            // When the resource groups are retrieved, we have code that will detect if the resource group is existing.
            // See azure-provider-step.component.ts's handleIfSavedCustomResourceGroupIsNowExisting()
            this.saveFormField(AzureForm.PROVIDER, 'resourceGroupCustom', payload.resourceGroup);

            this.saveMCName(payload.clusterName);

            // We canot tell if the vnet is custom or existing, so we load it into the custom field.
            // When the vnet resource groups are retrieved, we have code that will detect if the vnet is existing.
            // See vnet-step.component.ts's handleIfSavedVnetCustomNameIsNowExisting()
            const vnetAttrs = [
                ['vnetResourceGroup', 'vnetResourceGroup'],
                ["vnetName", "vnetNameCustom"],
                ["vnetCidr", "vnetCidrBlock"],
                ["controlPlaneSubnet", "controlPlaneSubnetNew"],
                ["controlPlaneSubnetCidr", "controlPlaneSubnetCidrNew"],
                ["workerNodeSubnet", "workerNodeSubnetNew"],
                ["workerNodeSubnetCidr", "workerNodeSubnetCidrNew"],
            ];
            vnetAttrs.forEach(attr => payload[attr[0]] = this.saveFormField(AzureForm.VNET, attr[1], payload[attr[0]]));
            this.saveFormField(AzureForm.VNET, 'privateAzureCluster', payload.isPrivateCluster);
            if (payload.isPrivateCluster) {
                this.saveFormField(AzureForm.VNET, 'privateIP', payload.frontendPrivateIp);
            }
            this.saveFormField(AzureForm.NODESETTING, 'enableAuditLogging', payload.enableAuditLogging);
            this.saveCommonFieldsFromPayload(payload);
        }
    }

    /**
     * @method method to trigger deployment
     */
    createRegionalCluster(payload: any): Observable<any> {
        return this.apiClient.createAzureRegionalCluster(payload);
    }

    /**
     * Return management/standalone cluster name
     */
    getMCName() {
        return this.getFieldValue(AzureForm.NODESETTING, "managementClusterName");
    }

    saveMCName(clusterName: string) {
        this.saveFormField(AzureForm.NODESETTING, "managementClusterName", clusterName);
    }

    /**
     * Get the CLI used to deploy the management/standalone cluster
     */
    getCli(configPath: string): string {
        const cliG = new CliGenerator();
        const cliParams: CliFields = {
            configPath: configPath,
            clusterType: this.getClusterType(),
            clusterName: this.getMCName(),
            extendCliCmds: []
        };
        return cliG.getCli(cliParams);
    }

    getCliEnvVariables() {
        let envVariableString = '';
        const resourceGroupOption = this.getFieldValue(AzureForm.PROVIDER, 'resourceGroupOption')
        const azureResourceGroup = resourceGroupOption === 'existing' ? 'resourceGroupExisting' : 'resourceGroupCustom';
        const vnetOption = this.getFieldValue(AzureForm.VNET, 'vnetOption');
        const azureVnetName = vnetOption === 'existing' ? 'vnetNameExisting' : 'vnetNameCustom';
        const azureControlPlaneSubnetName = vnetOption === 'existing' ? 'controlPlaneSubnet' : 'controlPlaneSubnetNew';
        const azureNodeSubnetName = vnetOption === 'existing' ? 'workerNodeSubnet' : 'workerNodeSubnetNew';
        const fieldsMapping = {
            AZURE_RESOURCE_GROUP: [AzureForm.PROVIDER, azureResourceGroup],
            AZURE_VNET_RESOURCE_GROUP: [AzureForm.VNET, 'vnetResourceGroup'],
            AZURE_VNET_NAME: [AzureForm.VNET, azureVnetName],
            AZURE_VNET_CIDR: [AzureForm.VNET, 'vnetCidrBlock'],
            AZURE_CONTROL_PLANE_SUBNET_NAME: [AzureForm.VNET, azureControlPlaneSubnetName],
            AZURE_CONTROL_PLANE_SUBNET_CIDR: [AzureForm.VNET, 'controlPlaneSubnetCidrNew'],
            AZURE_NODE_SUBNET_NAME: [AzureForm.VNET, azureNodeSubnetName],
            AZURE_NODE_SUBNET_CIDR: [AzureForm.VNET, 'workerNodeSubnetCidrNew']
        }
        let fields = [];
        if (vnetOption === 'existing') {
            fields = [
                'AZURE_RESOURCE_GROUP',
                'AZURE_VNET_RESOURCE_GROUP',
                'AZURE_VNET_NAME',
                'AZURE_CONTROL_PLANE_SUBNET_NAME',
                'AZURE_NODE_SUBNET_NAME'
            ];
        } else {
            fields = [
                'AZURE_RESOURCE_GROUP',
                'AZURE_VNET_RESOURCE_GROUP',
                'AZURE_VNET_NAME',
                'AZURE_VNET_CIDR',
                'AZURE_CONTROL_PLANE_SUBNET_NAME',
                'AZURE_CONTROL_PLANE_SUBNET_CIDR',
                'AZURE_NODE_SUBNET_NAME',
                'AZURE_NODE_SUBNET_CIDR'
            ];
        }
        fields.forEach(field => {
            const temp = fieldsMapping[field];
            envVariableString += `${field}="${this.getFieldValue(temp[0], temp[1])}" `;
        });
        return envVariableString;
    }
    applyTkgConfig() {
        return this.apiClient.applyTKGConfigForAzure({ params: this.getPayload() });
    }

    /**
     * Retrieve the config file from the backend and return as a string
     */
    retrieveExportFile() {
        return this.apiClient.exportTKGConfigForAzure({ params: this.getPayload() });
    }

    getAdditionalNoProxyInfo() {
        const vnetCidr = this.getFieldValue('vpcForm', 'vnetCidrBlock');
        return (vnetCidr ? vnetCidr + ',' : '')  + '169.254.0.0/16,168.63.129.16';
    }

    // returns TRUE if the file contents appear to be a valid config file for Azure
    // returns FALSE if the file is empty or does not appear to be valid. Note that in the FALSE
    // case we also alert the user.
    importFileValidate(nameFile: string, fileContents: string): boolean {
        if (fileContents.includes('AZURE_')) {
            return true;
        }
        alert(nameFile + ' is not a valid Azure configuration file!');
        return false;
    }

    importFileRetrieveClusterParams(fileContents: string): Observable<AzureRegionalClusterParams> {
        return this.apiClient.importTKGConfigForAzure( { params: { filecontents: fileContents } } );
    }

    importFileProcessClusterParams(nameFile: string, azureClusterParams: AzureRegionalClusterParams) {
        this.setFromPayload(azureClusterParams);
        this.resetToFirstStep();
        this.importService.publishImportSuccess(nameFile);
    }

    // returns TRUE if user (a) will not lose data on import, or (b) confirms it's OK
    onImportButtonClick() {
        let result = true;
        if (!this.isOnFirstStep()) {
            result = confirm('Importing will overwrite any data you have entered. Proceed with import?');
        }
        return result;
    }

    onImportFileSelected(event) {
        const params: ImportParams<AzureRegionalClusterParams> = {
            file: event.target.files[0],
            validator: this.importFileValidate,
            backend: this.importFileRetrieveClusterParams.bind(this),
            onSuccess: this.importFileProcessClusterParams.bind(this),
            onFailure: this.importService.publishImportFailure
        }
        this.importService.import(params);

        // clear file reader target so user can re-select same file if needed
        event.target.value = '';
    }
}
