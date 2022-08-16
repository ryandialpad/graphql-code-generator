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
import {
  OperationDefinitionNode,
  GraphQLSchema,
  NamedTypeNode,
  ListTypeNode,
  VariableDefinitionNode,
  SelectionNode,
  SelectionSetNode,
  VariableNode,
  FieldNode,
} from 'graphql';
import { pascalCase } from 'change-case-all';

export interface UrqlPluginConfig extends ClientSideBasePluginConfig {
  withComposition: boolean;
  urqlImportFrom: string;
}

export class UrqlVisitor extends ClientSideBaseVisitor<VueUrqlRawPluginConfig, UrqlPluginConfig> {
  private _externalImportPrefix = '';

  constructor(schema: GraphQLSchema, fragments: LoadedFragment[], rawConfig: VueUrqlRawPluginConfig) {
    // eslint-disable-next-line no-console
    //console.log('schema', schema);
    super(schema, fragments, rawConfig, {
      withComposition: getConfigValue(rawConfig.withComposition, true),
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

    if (this.config.withComposition) {
      imports.push(`import * as Urql from '${this.config.urqlImportFrom}';`);
      // TODO: Add import for faker or something
    }

    imports.push(OMIT_TYPE);

    return [...baseImports, ...imports];
  }

  private _buildCompositionFn(
    node: OperationDefinitionNode,
    operationType: string,
    documentVariableName: string,
    operationResultType: string,
    operationVariablesTypes: string
  ): string {
    const operationName: string = this.convertName(node.name?.value ?? '', {
      suffix: this.config.omitOperationSuffix ? '' : pascalCase(operationType),
      useTypesPrefix: false,
    });

    if (operationType === 'Mutation') {
      return `
export function use${operationName}() {
  return Urql.use${operationType}<${operationResultType}, ${operationVariablesTypes}>(${documentVariableName});
};`;
    }

    if (operationType === 'Subscription') {
      return `
export function use${operationName}<R = ${operationResultType}>(options: Omit<Urql.Use${operationType}Args<never, ${operationVariablesTypes}>, 'query'> = {}, handler?: Urql.SubscriptionHandlerArg<${operationResultType}, R>) {
  return Urql.use${operationType}<${operationResultType}, R, ${operationVariablesTypes}>({ query: ${documentVariableName}, ...options }, handler);
};`;
    }

    return `
export function use${operationName}(options: Omit<Urql.Use${operationType}Args<never, ${operationVariablesTypes}>, 'query'> = {}) {
  return Urql.use${operationType}<${operationResultType}>({ query: ${documentVariableName}, ...options });
};`;
  }

  private _mockNamedType(variable: VariableNode, type: NamedTypeNode) {
    return `
          ${variable.name.value}: '${type.name.value}',
    `;
  }

  private _mockListType(variable: VariableNode, type: ListTypeNode) {
    // TODO
    //let mockedVals = '';

    //eslint-disable-next-line no-console
    console.log('TODO: Implement _mockListType: ', variable, type);

    /*variableDefinitions.forEach(variableDefinition => {
      switch (variableDefinition.type.kind) {
        case 'ListType': {
          mockedVals += this._mockListType(variableDefinition.type);
          break;
        }
        case 'NonNullType': {
          if (variableDefinition.type.type.kind === 'ListType') {
            mockedVals += this._mockListType(variableDefinition.type.type);
          } else {
            mockedVals += this._mockNamedType(variableDefinition.type.type);
          }
          break;
        }
        case 'NamedType': {
          mockedVals += this._mockNamedType(variableDefinition.type);
          break;
        }
        default: {
          // TODO: throw some error or something
        }
      }

      return mockedVals;
    });*/
  }

  // TODO: Refactor this to not be recursive for efficiency sake
  private _getFieldType(name: string, typeMap: any): any {
    let foundType;

    Object.keys(typeMap).forEach(key => {
      if (typeMap[key]['name'] === name) {
        foundType = typeMap[key]['type']['ofType']['name'];
      } else if (typeMap[key]['_fields']) {
        const retFoundType = this._getFieldType(name, typeMap[key]['_fields']);
        if (!foundType) {
          foundType = retFoundType;
        }
      }
    });

    return foundType;
  }

  private _mockFieldData(name: string): any {
    const fieldType = this._getFieldType(name, this._schema.getTypeMap());

    switch (fieldType) {
      case 'String': {
        return "'some mocked string'";
      }
      case 'Int': {
        return 1234;
      }
      case 'Float': {
        return 1.234;
      }
      case 'Boolean': {
        return true;
      }
      case 'ID': {
        return "'1234'";
      }
      default: {
        // TODO: Better Error Handling
        throw new Error('Unsupported Type!');
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

  private _buildCompositionFnMock(
    node: OperationDefinitionNode,
    operationType: string,
    documentVariableName: string,
    operationResultType: string,
    operationVariablesTypes: string
  ): string {
    const operationName: string = this.convertName(node.name?.value ?? '', {
      suffix: this.config.omitOperationSuffix ? '' : pascalCase(operationType),
      useTypesPrefix: false,
    });

    // eslint-disable-next-line no-console
    console.log(
      'selectionSet',
      JSON.stringify(node.selectionSet, (k, v) => (k === 'loc' ? undefined : v), 2)
    );
    /*
      POTENTIAL TYPES:
        Case A
        NamedType => Create mock
        NonNullType => NamedType => Create mock

        Case B
        NonNullType => ListType => Call recursive create mock
        ListType => NamedType => For each create mock
        ListType => NonNullType => For each create mock
        ListType => ListType => Call recursive create mock
    */

    // eslint-disable-next-line no-console
    console.log(
      'testing some shit',
      JSON.stringify(
        //node.selectionSet.selections[0]['selectionSet']['selections'][0],
        (node.selectionSet.selections[0] as SelectionSetNode).selectionSet.selections[0],
        (k, v) => (k === 'loc' ? undefined : v),
        2
      )
    );

    // eslint-disable-next-line no-console
    console.log(Object.keys(this._schema.getTypeMap()));
    Object.keys(this._schema.getTypeMap()).forEach(typeMapEntry => {
      if (typeMapEntry === 'Entry') {
        // eslint-disable-next-line no-console
        console.log(this._schema.getTypeMap()[typeMapEntry]['_fields']);
      }
    });

    const mockedVals = this._mockSelectionSet(node.selectionSet);

    /*node.selectionSet.selections.forEach(selection => {
      // eslint-disable-next-line no-console

      // TODO: iterate through selection set, somehow figure out how to map types (can be ret from type map but not ideal)
      // example -> iterate through _fields, match name, inspect type.ofType.name
      switch (selection.kind) {
        case 'Field': {
          if (selection.selectionSet) {
            // TODO: Call some recursive function
          } else {
            mockedVals += this._mockFieldNode(selection);
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
          // TODO: Throw error or something
        }
      }*/

    /* else if (
        selection.type.kind === 'ListType' ||
        (selection.type.kind === 'NonNullType' && selection.type.type.kind === 'ListType')
      ) {
        if (selection.type.kind === 'ListType') {
          mockedVals += this._mockListType(selection.variable, selection.type);
        } else if (selection.type.kind === 'NonNullType') {
          // TODO: figure out what to do with this one
          //mockedVals += this._mockListType(variableDefinition.type.variable, variableDefinition.type.type as ListTypeNode);
        } else {
          // TODO: throw some error or something
        }
      } else if (selection.type.kind === 'NonNullType' && selection.type.type.kind === 'NamedType') {
        mockedVals += this._mockNamedType(selection.variable, selection.type.type);
      }*/
    //});

    // eslint-disable-next-line no-console
    console.log(`
      operationName: ${operationName}
      documentVariableName: ${documentVariableName}
      operationResultType: ${operationResultType}
      operationVariablesTypes: ${operationVariablesTypes}
    `);
    return `
export function ${operationName}Mocks() {
  return {
    use${operationName}: vi.fn(() => {
      return Promise.resolve({
        fetching: ref(false),
        error: ref(null),
        data: {
          ${mockedVals}
        },
      });
    }),
  }
};`;

    /*if (operationType === 'Mutation') {
      return `
export function use${operationName}() {
  return Urql.use${operationType}<${operationResultType}, ${operationVariablesTypes}>(${documentVariableName});
};`;
    }

    if (operationType === 'Subscription') {
      return `
export function use${operationName}<R = ${operationResultType}>(options: Omit<Urql.Use${operationType}Args<never, ${operationVariablesTypes}>, 'query'> = {}, handler?: Urql.SubscriptionHandlerArg<${operationResultType}, R>) {
  return Urql.use${operationType}<${operationResultType}, R, ${operationVariablesTypes}>({ query: ${documentVariableName}, ...options }, handler);
};`;
    }

    return `
export function use${operationName}(options: Omit<Urql.Use${operationType}Args<never, ${operationVariablesTypes}>, 'query'> = {}) {
  return Urql.use${operationType}<${operationResultType}>({ query: ${documentVariableName}, ...options });
};`;*/
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
    if (this.config.withComposition) {
      composition = this._buildCompositionFn(
        node,
        operationType,
        documentVariablePrefixed,
        operationResultTypePrefixed,
        operationVariablesTypesPrefixed
      );

      const mock = this._buildCompositionFnMock(
        node,
        operationType,
        documentVariablePrefixed,
        operationResultTypePrefixed,
        operationVariablesTypesPrefixed
      );

      // eslint-disable-next-line no-console
      console.log('mock', mock);
    } else {
      composition = null;
    }

    return [composition].filter(a => a).join('\n');
  }
}
