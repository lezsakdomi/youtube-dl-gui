import React from 'react';
import { lookpath } from 'lookpath';
import fs from 'fs';
import { remote } from 'electron';
import path from 'path';
import log from 'electron-log';
import { execFile } from 'child_process';
import { XTerm } from 'xterm-for-react';
import { FitAddon } from 'xterm-addon-fit';
import { spawn } from 'node-pty';
import prompt from 'electron-prompt';
import https from 'https';
import styles from './Home.css';

const { app, dialog } = remote;

export default class Home extends React.Component<
  {
    program?: string;
  },
  {
    executable?: string | null;
    help?: string | null;
    arguments: string[];
    argvIndexShift: number;
    xTermRef?: React.RefObject<XTerm>;
    initError?: Error;
  }
> {
  private readonly fitAddon: FitAddon;

  constructor(props: {}) {
    super(props);

    this.state = {
      arguments: [],
      argvIndexShift: 0
    };

    this.fitAddon = new FitAddon();
  }

  componentDidMount() {
    this.initialize().catch(e => {
      log.error('Failed to initialize', e);
      this.setState({ initError: e });
    });
  }

  // eslint-disable-next-line class-methods-use-this
  get program() {
    const { program } = this.props;
    return program || 'youtube-dl';
  }

  get downloadUrl() {
    const downloadUrls: { [program: string]: string | undefined } = {};

    switch (process.platform) {
      case 'win32':
        Object.assign(downloadUrls, {
          'youtube-dl': 'https://yt-dl.org/downloads/latest/youtube-dl.exe'
        });
        break;

      case 'linux':
        Object.assign(downloadUrls, {
          'youtube-dl': 'https://yt-dl.org/downloads/latest/youtube-dl'
        });
        break;

      default:
        Object.assign(downloadUrls, {});
    }

    return downloadUrls[this.program];
  }

  get installUrl() {
    const installUrls: { [program: string]: string | undefined } = {
      'youtube-dl': 'https://ytdl-org.github.io/youtube-dl/download.html',
      ffmpeg: 'https://ffmpeg.zeranoe.com/builds/'
    };

    return installUrls[this.program];
  }

  async findExecutable(): Promise<string | undefined> {
    try {
      const executable = path.join(
        app.getPath('userData'),
        'downloads',
        this.program
      );
      await fs.promises.access(executable);
      return executable;
    } catch {
      // noop
    }

    try {
      const executable = path.join(
        app.getPath('userData'),
        'downloads',
        `${this.program}.exe`
      );
      await fs.promises.access(executable);
      return executable;
    } catch {
      // noop
    }

    {
      const executable = await lookpath(this.program);
      if (executable) return executable;
    }

    // {
    //   const executable = await lookpath(`${this.program}.exe`);
    //   if (executable) return executable;
    // }

    return undefined;
  }

  protected async initialize() {
    const executable = await this.findExecutable();

    if (executable) {
      this.setState({ executable });

      const help: string | null = await new Promise((resolve, reject) =>
        execFile(executable, ['-h'], (e, stdout, stderr) => {
          if (e && (!e.code || e.killed || e.signal)) reject(e);
          else if (stdout) resolve(stdout);
          else if (stderr) resolve(stderr);
          else resolve(null);
        })
      );

      this.setState({ help });
    } else {
      this.setState({ executable: null });
    }
  }

  protected download(url: string) {
    return new Promise((resolve, reject) =>
      https.get(url, res => {
        // const filename = url.replace(/.*\//, '');
        const filename =
          process.platform === 'win32' ? `${this.program}.exe` : this.program;
        const file = path.join(app.getPath('userData'), 'downloads', filename);

        res.pipe(fs.createWriteStream(file)).on('close', resolve);
        res.on('error', reject);
      })
    );
  }

  protected run() {
    const {
      executable,
      arguments: args,
      xTermRef: previousProcess
    } = this.state;

    if (typeof executable !== 'string')
      throw new Error(`${this.program} is not found`);

    if (previousProcess) throw new Error(`Process is already running`);

    const xTermRef = React.createRef<XTerm>();
    this.setState({ xTermRef });

    setImmediate(() => {
      if (!xTermRef.current) {
        log.warn('Failed to spawn process: Terminal unavailable');
        return;
      }

      try {
        this.fitAddon.fit();
      } catch (e) {
        log.warn('Failed to fit the terminal', e);
      }

      const { terminal } = xTermRef.current;

      const pty = spawn(executable, args, {
        cwd: app.getPath('downloads'),
        rows: terminal.rows,
        cols: terminal.cols
      });

      terminal.onData(data => pty.write(data));
      pty.onData(data => {
        if (xTermRef.current) xTermRef.current.terminal.write(data);
        else log.warn('Failed to write data to the terminal');
      });

      pty.onExit(({ exitCode, signal }) => {
        dialog
          .showMessageBox({
            title: `${this.program} finished`,
            message: exitCode
              ? `${this.program} failed with ${
                  signal === undefined ? `code ${exitCode}` : `signal ${signal}`
                }`
              : `${this.program} completed`
          })
          .then(() => {
            this.setState({ xTermRef: undefined });
            return undefined;
          })
          .catch(e => {
            log.error(e);
          });
      });

      log.info('Started', this.program, JSON.stringify(args));
    });
  }

  protected renderHelp() {
    const { help } = this.state;

    if (help === undefined) {
      // todo revise wording
      return <p>Please wait, getting help...</p>;
    }

    if (help === null) {
      return <p>Sorry, help is not available</p>;
    }

    return <textarea className={styles.help} value={help} readOnly />;
  }

  protected renderRun() {
    const { arguments: args, xTermRef } = this.state;

    const runComponent = xTermRef ? (
      <XTerm
        className={styles.terminal}
        ref={xTermRef}
        addons={[this.fitAddon]}
      />
    ) : (
      <button type="submit">Run</button>
    );

    return (
      <form
        onSubmit={event => {
          try {
            this.run();
          } catch (e) {
            log.error(e);
            dialog.showErrorBox(`Failed to run ${this.program}`, e.toString());
          }
          event.preventDefault();
        }}
      >
        {[this.program].concat(args).map(this.renderArgument.bind(this))}
        <button
          className={styles.add}
          type="button"
          disabled={!!xTermRef}
          onClick={() => {
            prompt(
              {
                title: `${this.program}: New argument`,
                label: `Please feed <code>${this.program}</code> with some input`,
                useHtmlLabel: true,
                inputAttrs: {
                  placeholder: 'https://youtube.com/watch?v=...'
                },
                resizable: true
              }
              // remote.getCurrentWindow()
            )
              .then((newArg: string | null) => {
                if (newArg !== null) {
                  const { arguments: currentArgs } = this.state;
                  this.setState({ arguments: currentArgs.concat(newArg) });
                }

                return undefined;
              })
              .catch((e: Error) => {
                log.error('Failed to show new arg prompt', e);
              });
          }}
        >
          + Add
        </button>
        <br />
        {runComponent}
      </form>
    );
  }

  protected renderArgument(arg: string, index: number, argv: string[]) {
    const { xTermRef, argvIndexShift } = this.state;

    const spliceArgv = (start: number, del: number, ...add: string[]) => {
      const newArgv = [...argv];
      newArgv.splice(start, del, ...add);
      this.setState({
        arguments: newArgv.slice(1),
        argvIndexShift: argvIndexShift + del - add.length
      });
    };

    const shiftArgv = (delta: number) => {
      this.setState({ argvIndexShift: argvIndexShift + delta });
    };

    return (
      <input
        className={styles.argument}
        type="text"
        value={arg}
        style={{
          color: index > 0 ? 'black' : 'grey',
          width: `${Math.max(0, arg.length) * 8}px`
        }}
        onKeyDown={event => {
          const target = event.target as HTMLInputElement;

          switch (event.key) {
            case 'Backspace':
              if (target.value === '') {
                spliceArgv(index, 1);
                event.preventDefault();
              } else if (target.selectionStart === 0 && index > 1) {
                spliceArgv(index - 1, 2, argv[index - 1] + argv[index]);
                event.preventDefault();
              }
              break;

            case 'ArrowLeft':
              if (target.selectionStart === 0) {
                shiftArgv(1);
                event.preventDefault();
              }
              break;

            case 'ArrowRight':
              if (target.selectionEnd === target.value.length) {
                shiftArgv(-1);
                event.preventDefault();
              }
              break;

            default:
            // noop
          }
        }}
        onKeyUp={event => {
          const target = event.target as HTMLInputElement;
          switch (event.key) {
            case ' ':
              if (target.selectionStart === target.value.length) {
                if (!target.value.endsWith('\\ ') || index === 0)
                  spliceArgv(index, 1, target.value.slice(0, -1), '');
                else spliceArgv(index, 1, `${target.value.slice(0, -2)} `);
              }
              break;

            default:
            // noop
          }
        }}
        onChange={event => {
          spliceArgv(index, 1, event.target.value);
        }}
        key={index + argvIndexShift}
        disabled={!!xTermRef}
      />
    );
  }

  protected renderInstallInstructions() {
    if (this.downloadUrl) {
      const { downloadUrl } = this;

      return (
        <div>
          <p>
            Click
            <a
              href={downloadUrl}
              onClick={event => {
                this.download(downloadUrl)
                  .then(() => {
                    return this.initialize();
                  })
                  .catch((e: Error) => {
                    log.error('Failed to download and reinitialize', e);
                    // noinspection JSIgnoredPromiseFromCall
                    dialog.showMessageBox({
                      message:
                        'Something went wrong. ' +
                        'Please install the software manually or ' +
                        'save the downloaded file to C:\\Windows\\System32.\n' +
                        `Download URL: + ${downloadUrl}`
                    });
                  });
                event.preventDefault();
              }}
            >
              here
            </a>
            to let us download and install
            {this.program}
          </p>
        </div>
      );
    }

    if (this.installUrl) {
      return (
        <div>
          <p>
            {/* eslint-disable-next-line react/jsx-one-expression-per-line */}
            Click <a href={this.installUrl}>here</a> to install {this.program}
          </p>
          <button type="button" onClick={() => this.initialize()}>
            Recheck
          </button>
        </div>
      );
    }

    return (
      <div>
        <p>
          {/* eslint-disable-next-line react/jsx-one-expression-per-line */}
          Please install {this.program} manually.
        </p>
      </div>
    );
  }

  public render() {
    const { initError, executable } = this.state;

    if (initError) {
      return (
        <div className={styles.container} data-tid="container">
          <p>Ugh, something terrible happened. Check the details below.</p>
          <pre>{initError.message}</pre>
        </div>
      );
    }

    if (executable === undefined) {
      return (
        <div className={styles.container} data-tid="container">
          <p>
            {/* eslint-disable-next-line react/jsx-one-expression-per-line */}
            Please wait, locating your <code>{this.program}</code>...
          </p>
        </div>
      );
    }

    if (executable === null) {
      return (
        <div className={styles.container} data-tid="container">
          <p>
            {/* eslint-disable-next-line react/jsx-one-expression-per-line */}
            Whoops, it looks like you haven&apos;t installed{' '}
            <code>{this.program}</code>
          </p>
          {this.renderInstallInstructions()}
        </div>
      );
    }

    return (
      <div className={styles.container} data-tid="container">
        <p>
          {/* eslint-disable-next-line react/jsx-one-expression-per-line */}
          Using <code>{executable}</code>
        </p>
        {this.renderHelp()}
        {this.renderRun()}
      </div>
    );
  }
}
