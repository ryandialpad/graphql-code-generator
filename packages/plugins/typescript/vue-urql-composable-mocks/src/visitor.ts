import {
  ClientSideBaseVisitor,
  ClientSideBasePluginConfig,
  LoadedFragment,
  getConfigValue,
  OMIT_TYPE,
  DocumentMode,
} from '@graphql-codegen/visitor-plugin-common';
import { VueUrqlRawPluginConfig } from './config.js';
import autoBind from 'auto-bind';
import { OperationDefinitionNode, GraphQLSchema, SelectionSetNode, FieldNode } from 'graphql';
import { pascalCase } from 'change-case-all';

export interface UrqlPluginConfig extends ClientSideBasePluginConfig {
  withComposition: boolean;
  withMocks: boolean;
  urqlImportFrom: string;
}

export class UrqlVisitor extends ClientSideBaseVisitor<VueUrqlRawPluginConfig, UrqlPluginConfig> {
  private _externalImportPrefix = '';

  constructor(schema: GraphQLSchema, fragments: LoadedFragment[], rawConfig: VueUrqlRawPluginConfig) {
    super(schema, fragments, rawConfig, {
      withComposition: getConfigValue(rawConfig.withComposition, true),
      withMocks: getConfigValue(rawConfig.withMocks, true),
      urqlImportFrom: getConfigValue(rawConfig.urqlImportFrom, '@urql/vue'),
    });

    if (this.config.importOperationTypesFrom) {
      this._externalImportPrefix = `${this.config.importOperationTypesFrom}.`;

      if (this.config.documentMode !== DocumentMode.external || !this.config.importDocumentNodeExternallyFrom) {
        // eslint-disable-next-line no-console
        console.warn(
          '"importOperationTypesFrom" should be used with "documentMode=external" and "importDocumentNodeExternallyFrom"'
        );
      }

      if (this.config.importOperationTypesFrom !== 'Operations') {
        // eslint-disable-next-line no-console
        console.warn('importOperationTypesFrom only works correctly when left empty or set to "Operations"');
      }
    }

    autoBind(this);
  }

  public getImports(): string[] {
    const baseImports = super.getImports();
    const imports = [];
    const hasOperations = this._collectedOperations.length > 0;

    if (!hasOperations) {
      return baseImports;
    }

    /*if (this.config.withComposition) {
      imports.push(`import * as Urql from '${this.config.urqlImportFrom}';`);
    }*/

    if (this.config.withMocks) {
      imports.push(`import { faker } from '@faker-js/faker';`);
      imports.push(`import { vi } from 'vitest';`);
      imports.push(`import { ref } from 'vue';`);
      imports.push(`import type { Ref } from 'vue';`);
    }

    imports.push(OMIT_TYPE);

    return [...baseImports, ...imports];
  }

  // TODO: Refactor this brute force recursive solution
  private _getFieldType(name: string, typeMap: any): any {
    let foundType;

    Object.keys(typeMap).every(key => {
      if (typeMap[key]['name'] === name) {
        foundType = typeMap[key]?.type?.ofType?.name;
        return false; // Match found, exit loop
      } else if (typeMap[key]['_fields']) {
        const retFoundType = this._getFieldType(name, typeMap[key]['_fields']);
        if (!foundType && retFoundType) {
          foundType = retFoundType;
          return false; // Match found, exit loop
        }
      }

      return true;
    });

    return foundType;
  }

  private _mockFieldData(name: string): any {
    // TODO: Might be able to narrow this down to query / mutation / subscription types
    const fieldType = this._getFieldType(name, this._schema.getTypeMap());

    switch (fieldType) {
      case 'String': {
        return 'faker.lorem.sentence()';
      }
      case 'Int': {
        return 'faker.datatype.number()';
      }
      case 'Float': {
        return 'faker.datatype.float()';
      }
      case 'Boolean': {
        return 'faker.datatype.boolean()';
      }
      case 'ID': {
        return 'faker.datatype.uuid()';
      }
      default: {
        // TODO: Better Error Handling
        //throw new Error('Unsupported Type!');
      }
    }
  }

  private _mockFieldNode(selection: FieldNode): string {
    return `
          ${selection.name.value}: ${this._mockFieldData(selection.name.value)},
`;
  }

  // TODO: Clean this abomonation up
  private _mockSelectionSet(selectionSet: SelectionSetNode): string {
    let mockedVals = '';

    selectionSet.selections.forEach(selection => {
      switch (selection.kind) {
        case 'Field': {
          // eslint-disable-next-line
          //console.log('_mockSelectionSet', selection);
          if (selection.selectionSet) {
            if (mockedVals.length < 1) {
              mockedVals = `${selection.name.value}: {${this._mockSelectionSet(selection.selectionSet)}
          },`;
            } else {
              mockedVals += `${selection.name.value}: {${this._mockSelectionSet(selection.selectionSet)}
          },`;
            }
          } else {
            // eslint-disable-next-line
            if (mockedVals.length < 1) {
              mockedVals = this._mockFieldNode(selection);
            } else {
              mockedVals += this._mockFieldNode(selection);
            }
          }
          break;
        }
        case 'FragmentSpread': {
          // TODO: Probably will not support for POC purposes
          break;
        }
        case 'InlineFragment': {
          // TODO: Probably will not support for POC purposes
          break;
        }
        default: {
          // TODO: Proper error handling
          throw new Error('Unsupported!');
        }
      }
    });

    return mockedVals;
  }

  /*
    TODO:
      FEATURE: Allow users to supply static data <COMPLETE>
        Example: { fetching, error, data}: { fetching: boolean, error: TODO, data: TODO}
      FEATURE: Add subscription support
      FEATURE: Add fragment support
      UPGRADE: Add error handling
      UPGRADE: Refactor brute force solutions
      UPGRADE: Remove composition generation
      REFACTORING: Clean up messy code
  */
  private _buildCompositionFnMock(
    node: OperationDefinitionNode,
    operationType: string,
    operationResultType: string
  ): string {
    const operationResultTypePrefixed = this._externalImportPrefix + operationResultType;
    const operationName: string = this.convertName(node.name?.value ?? '', {
      suffix: this.config.omitOperationSuffix ? '' : pascalCase(operationType),
      useTypesPrefix: false,
    });

    const mockedVals = this._mockSelectionSet(node.selectionSet);

    // eslint-disable-next-line
    console.log('operationResultTypePrefixed', operationResultTypePrefixed);
    if (operationType === 'Query') {
      return `
export function use${operationName}Mocks({
  fetching = ref(false),
  error = ref(null),
  data = ref({
    ${mockedVals}
  }),
}: {
  fetching?: Ref<boolean>,
  error?: Ref<object | null>,
  data?: Ref<Types.${operationResultTypePrefixed}>
} = {
  fetching: ref(false),
  error: ref(null),
  data: ref({
    ${mockedVals}
  }),
}): object {
  return {
    use${operationName}: vi.fn(() => {
      return {
        fetching,
        error,
        data,
      };
    }),
  };
}`;
    }

    if (operationType === 'Mutation') {
      return `
export function use${operationName}Mocks({
  fetching = ref(false),
  error = ref(null),
  data = {
    ${mockedVals}
  },
}: {
  fetching?: Ref<boolean>,
  error?: Ref<object | null>,
  data?: Types.${operationResultTypePrefixed}
} = {
  fetching: ref(false),
  error: ref(null),
  data: {
    ${mockedVals}
  },
}): object {
  const ${operationName}ExecuteMutationMock = vi.fn(() => {
    return Promise.resolve({
      data,
      error: error.value,
    });
  });

  return {
    ${operationName}ExecuteMutationMock,
    use${operationName}: vi.fn(() => {
      return {
        fetching,
        error,
        executeMutation: ${operationName}ExecuteMutationMock,
      };
    }),
  };
}`;
    }

    return `
export function use${operationName}Mocks() {
  return {
    use${operationName}: vi.fn(() => console.log('Error: Not Implemented')),
  };
}`;
  }

  protected buildOperation(
    node: OperationDefinitionNode,
    documentVariableName: string,
    operationType: string,
    operationResultType: string,
    operationVariablesTypes: string
  ): string {
    const documentVariablePrefixed = this._externalImportPrefix + documentVariableName;
    const operationResultTypePrefixed = this._externalImportPrefix + operationResultType;
    const operationVariablesTypesPrefixed = this._externalImportPrefix + operationVariablesTypes;

    let composition;
    let mock;
    if (this.config.withComposition) {
      // eslint-disable-next-line no-console
      console.log(documentVariablePrefixed, operationResultTypePrefixed, operationVariablesTypesPrefixed);

      if (this.config.withMocks) {
        mock = this._buildCompositionFnMock(node, operationType, operationResultType);

        // eslint-disable-next-line no-console
        console.log('Created Composition Mock: ', composition, mock);

        //composition += mock;
      }
    } else {
      composition = null;
    }

    return [mock].filter(a => a).join('\n');
  }
}
