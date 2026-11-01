import { RequestContext } from '../../../http/request-context.js'

/** Opt-in audit stamps for repositories with createdBy/updatedBy fields. Never accept these from input. */
export class AuditFields {
  static onCreate() {
    const actorId = RequestContext.requireActorId()
    return { createdBy: actorId, updatedBy: actorId }
  }

  static onUpdate() {
    return { updatedBy: RequestContext.requireActorId() }
  }
}
