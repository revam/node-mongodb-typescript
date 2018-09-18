import { classToPlain, plainToClass } from 'class-transformer';
import { Collection as MongoCollection, FilterQuery, MongoClient, ObjectId } from 'mongodb';

import { Ref } from '.';
import { Entity } from './entity';

export declare type ClassType<T> = {
  new(...args: any[]): T;
};

export class Repository<T extends Entity> {

  /**
   * Underlying mongodb collection (use with caution)
   */
  collection: MongoCollection<T>;

  constructor(protected Type: ClassType<T>, mongo: MongoClient, collection: string) {
    this.collection = mongo.db().collection(collection);
  }

  async insert(entity: T) {
    const plain = this.dehydrate(entity);
    const res = await this.collection.insertOne(plain);
    entity._id = res.insertedId;
  }

  async update(entity: T) {
    const plain = this.dehydrate(entity);
    await this.collection.updateOne({ _id: entity._id }, { $set: plain });
  }

  async save(entity: T) {
    if (!entity._id)
      await this.insert(entity);
    else
      await this.update(entity);
  }

  async findOne(query: FilterQuery<T> = {}): Promise<T | null> {
    return this.hydrate(await this.collection.findOne<Object>(query));
  }

  async findById(_id: ObjectId): Promise<T | null> {
    return this.findOne({ _id });
  }

  async find(query?: FilterQuery<T>) {
    const plain = await this.collection.find(query).toArray();
    return plainToClass<T, any[]>(this.Type, plain);
  }

  async populate<S extends Entity>(Type: ClassType<S>, entity: S, refName: string) {
    const refs = Reflect.getMetadata('mongo:refs', Type.prototype) || {};
    const ref: Ref<S> = refs[refName];

    if (ref.typeFunction().prototype !== this.Type.prototype)
      throw new Error(`incompatible repository: expected ${ref.typeFunction().name}, got ${this.Type.name}`);

    (entity as any)[ref.name] = await this.findById((entity as any)[ref.id] as ObjectId);
  }

  /**
   * Gets the number of documents matching the filter.
   * http://mongodb.github.io/node-mongodb-native/3.1/api/Collection.html#estimatedDocumentCount
   * http://mongodb.github.io/node-mongodb-native/3.1/api/Collection.html#countDocuments
   * @param estimate whether estimatedDocumentCount or countDocuments will be called.
   * @returns integer
   */
  async count(query?: FilterQuery<T>, estimate = true) {
    if (estimate)
      return this.collection.estimatedDocumentCount(query);
    else
      return this.collection.countDocuments(query);
  }

  dehydrate(entity: T): Object {
    const refs = Reflect.getMetadata('mongo:refs', this.Type.prototype) || {};

    const plain = classToPlain(entity) as any;

    for (let name in refs) {
      const ref: Ref<any> = refs[name];
      if (plain[ref.name]) {
        (entity as any)[ref.id] = (entity as any)[ref.name]._id;
        plain[ref.id] = plain[ref.name]._id;

        delete plain[ref.name];
      }
    }
    return plain;
  }

  hydrate(plain: Object | null) {
    return plain ? plainToClass<T, Object>(this.Type, plain) : null;
  }
}