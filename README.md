# Yuvraj Sandhu · Portfolio

A single-page portfolio built with plain HTML, CSS and vanilla JavaScript. There's no build step and no dependencies.

```
.
├── index.html            # all page content
├── .nojekyll             # tells GitHub Pages to serve files as-is
├── README.md
└── assets/
    ├── css/styles.css    # design tokens (light/dark), layout, components
    ├── js/main.js        # theme toggle, mobile nav, scrollspy, reveal, scope traces
    ├── img/favicon.svg
    └── docs/             # put Yuvraj_Sandhu_Resume.pdf here
```

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python -m http.server 8000   # then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Commit and push to `main`.
2. On GitHub, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then select `main` / `(root)`.
3. The site is published at:
   - `https://sandhuy.github.io/yuvraj.github.io/` while the repo is named `yuvraj.github.io`, or
   - `https://sandhuy.github.io/` if you rename the repo to **`Sandhuy.github.io`**. A user site has to be named after your GitHub username.

All asset paths are relative, so the site works at either URL.

## Editing

- **Content**: everything lives in `index.html`, one commented block per section.
- **Colours and fonts**: change the tokens at the top of `assets/css/styles.css`. Light and dark values are defined separately.
- **Placeholders**: search the project for `TODO`.
