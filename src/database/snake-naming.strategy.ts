import { DefaultNamingStrategy, NamingStrategyInterface } from "typeorm";

function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** camelCase properties → snake_case columns, so SQL stays idiomatic. Table names are explicit in @Entity(). */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
    const base = customName ?? snake(propertyName);
    return embeddedPrefixes.length ? `${embeddedPrefixes.map(snake).join("_")}_${base}` : base;
  }

  relationName(propertyName: string): string {
    return snake(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }

  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string): string {
    return snake(`${firstTableName}_${firstPropertyName.replace(/\./gi, "_")}_${secondTableName}`);
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snake(`${tableName}_${columnName ?? propertyName}`);
  }
}
