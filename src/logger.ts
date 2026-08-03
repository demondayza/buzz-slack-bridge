type LogFields = Record<string, boolean | number | string | undefined>;

function write(level: "debug" | "error" | "info" | "warn", message: string, fields: LogFields) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => write("debug", message, fields),
  error: (message: string, fields: LogFields = {}) => write("error", message, fields),
  info: (message: string, fields: LogFields = {}) => write("info", message, fields),
  warn: (message: string, fields: LogFields = {}) => write("warn", message, fields),
};
