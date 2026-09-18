import { createTheme } from '@mui/material/styles';
export const weatherTheme = createTheme({
  palette: { primary: { main: '#0878ad' }, secondary: { main: '#c04a26' }, background: { default: '#edf2f7', paper: '#ffffff' }, text: { primary: '#19364b', secondary: '#526b7e' } },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif', button: { textTransform: 'none', fontWeight: 650 }, h2: { fontWeight: 700 } },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { defaultProps: { size: 'small', variant: 'outlined' }, styleOverrides: { root: { minHeight: 44, borderRadius: 'var(--control-radius, 10px)', fontSize: '.9375rem' } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { overflow: 'visible' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 48, fontWeight: 700 } } },
  },
});
