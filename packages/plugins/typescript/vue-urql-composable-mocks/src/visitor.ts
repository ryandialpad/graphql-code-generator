import {
  ClientSideBaseVisitor,
  ClientSideBasePluginConfig,
  LoadedFragment,
  OMIT_TYPE,
  DocumentMode,
} from '@graphql-codegen/visitor-plugin-common';
import { VueUrqlRawPluginConfig } from './config.js';
import autoBind from 'auto-bind';
import { OperationDefinitionNode, GraphQLSchema, SelectionSetNode, FieldNode } from 'graphql';
import { pascalCase } from 'change-case-all';

export interface UrqlPluginConfig extends ClientSideBasePluginConfig {}

export class UrqlVisitor extends ClientSideBaseVisitor<VueUrqlRawPluginConfig, UrqlPluginConfig> {
  private _externalImportPrefix = '';

  constructor(schema: GraphQLSchema, fragments: LoadedFragment[], rawConfig: VueUrqlRawPluginConfig) {
    super(schema, fragments, rawConfig, {});

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

    imports.push(`import { faker } from '@faker-js/faker';`);
    imports.push(`import { vi } from 'vitest';`);
    imports.push(`import { ref } from 'vue';`);
    imports.push(`import type { Ref } from 'vue';`);

    imports.push(OMIT_TYPE);

    return [...baseImports, ...imports];
  }

  // TODO: Refactor this brute force recursive solution
  // TODO: Potentially error prone, will return the first instance of a target key
  private _getFieldType(name: string, typeMap: any): any {
    let foundType;

    Object.keys(typeMap).every(key => {
      if (typeMap[key]['name'] === name) {
        foundType = typeMap[key]?.type?.name ?? typeMap[key]?.type?.ofType?.name;

        // TODO: add error handling in the event that the type does not have a name

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

  private _mockFieldData(name: string, operationName: string, operationType: string): any {
    let fieldType;
    // TODO: add support for other operation types
    if (operationType === 'Query') {
      fieldType = this._getFieldType(
        name,
        this._schema.getQueryType()['_fields'][operationName].type.ofType['_fields']
      );
    } else if (operationType === 'Mutation') {
      fieldType = this._getFieldType(
        name,
        this._schema.getMutationType()['_fields'][operationName].type.ofType['_fields']
      );
    }

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
      }
    }
  }

  private _mockFieldNode(selection: FieldNode, operationName: string, operationType: string): string {
    return `
          ${selection.name.value}: ${this._mockFieldData(selection.name.value, operationName, operationType)},`;
  }

  // keep track of the path down
  private _mockSelectionSet(selectionSet: SelectionSetNode, operationName: string, operationType: string): string {
    let mockedVals = '';

    selectionSet.selections.forEach(selection => {
      switch (selection.kind) {
        case 'Field': {
          // TODO: clean this logic up
          if (selection.selectionSet) {
            if (mockedVals.length < 1) {
              mockedVals = `${selection.name.value}: {${this._mockSelectionSet(
                selection.selectionSet,
                operationName,
                operationType
              )}
        },`;
            } else {
              mockedVals += `${selection.name.value}: {${this._mockSelectionSet(
                selection.selectionSet,
                operationName,
                operationType
              )}
        },`;
            }
          } else if (mockedVals.length < 1) {
            mockedVals = this._mockFieldNode(selection, operationName, operationType);
          } else {
            mockedVals += this._mockFieldNode(selection, operationName, operationType);
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
      FEATURE: Add support for multi operations
      UPGRADE: Add error handling
      UPGRADE: Refactor brute force solutions
      UPGRADE: Remove composition generation <COMPLETE>
      REFACTORING: Clean up messy code
      BUG: Use selection to determine the sub type map to use in case of duplicate field names
        // Can probably keep track using a stack and then use that stack to immidiately retreive the type
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

    const mockedVals = this._mockSelectionSet(
      node.selectionSet,
      // Retreives the first operation selection
      // TODO: add support for multi operation selections
      node.selectionSet.selections[0]['name']['value'],
      operationType
    );

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
    _documentVariableName: string,
    operationType: string,
    operationResultType: string,
    _operationVariablesTypes: string
  ): string {
    const mock = this._buildCompositionFnMock(node, operationType, operationResultType);
    return [mock].filter(a => a).join('\n');
  }
}
