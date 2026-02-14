/**
 * Manually flush the Telegram retry queue.
 * See FinalStrategy.md line 713.
 */

import { logger } from "../logger";

logger.info("Retry alerts triggered — flushing Telegram retry queue");
// TODO: Read alerts_retry_queue, resend, clear
logger.warn("Retry alerts not implemented yet");
