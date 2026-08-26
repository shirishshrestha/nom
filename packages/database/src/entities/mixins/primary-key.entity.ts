import { PrimaryGeneratedColumn } from "typeorm";

export abstract class PrimaryKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
}